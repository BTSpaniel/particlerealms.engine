// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

// MathEntropy.js - histograms, entropy reports, and distribution diagnostics.

import { statsMean } from './MathStatistics.js';

const DEFAULT_LOG_BASE = 2;
const DEFAULT_SYMBOL_BITS = 8;
const DEFAULT_HEALTH_FALSE_POSITIVE_PROBABILITY = 2 ** -20;

function assertLogBase(base) {
  if (!Number.isFinite(base) || base <= 0 || base === 1) {
    throw new RangeError('entropy log base must be finite, positive, and not 1');
  }
  return base;
}

function assertPositiveInteger(value, name) {
  if (!Number.isInteger(value) || value <= 0) {
    throw new RangeError(`${name} must be a positive integer`);
  }
  return value;
}

function logBase(value, base) {
  return Math.log(value) / Math.log(base);
}

function finiteNonnegative(value, name) {
  if (!Number.isFinite(value) || value < 0) {
    throw new RangeError(`${name} must be finite and nonnegative`);
  }
  return value;
}

function normalizedDistribution(distribution, name, smoothing = 0) {
  if (!distribution || !Number.isInteger(distribution.length) || distribution.length <= 0) {
    throw new RangeError(`${name} must not be empty`);
  }

  const smooth = finiteNonnegative(smoothing, 'smoothing');
  const values = new Float64Array(distribution.length);
  let total = 0;
  for (let i = 0; i < distribution.length; i++) {
    const value = finiteNonnegative(Number(distribution[i]), `${name}[${i}]`) + smooth;
    values[i] = value;
    total += value;
  }
  return { values, total };
}

function byteView(data) {
  if (data instanceof Uint8Array) return data;
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  if (ArrayBuffer.isView(data)) {
    return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  }
  if (!data || typeof data[Symbol.iterator] !== 'function') {
    throw new TypeError('entropy byte data must be an ArrayBuffer, ArrayBuffer view, or iterable byte values');
  }

  const values = Array.from(data, (value, index) => {
    if (!Number.isInteger(value) || value < 0 || value > 255) {
      throw new RangeError(`byte value at index ${index} must be an integer in [0, 255]`);
    }
    return value;
  });
  return Uint8Array.from(values);
}

function shouldReadAsBytes(data, bytesOption) {
  if (bytesOption === true || data instanceof ArrayBuffer) return true;
  if (!ArrayBuffer.isView(data)) return false;
  if (!Number.isInteger(data.length)) return true;
  for (let i = 0; i < data.length; i++) {
    if (Number(data[i]) > 1) return true;
  }
  return false;
}

function bitSequence(data, options = {}) {
  const bitOrder = options.bitOrder ?? 'msb';
  if (bitOrder !== 'msb' && bitOrder !== 'lsb') {
    throw new RangeError("bitOrder must be 'msb' or 'lsb'");
  }

  if (shouldReadAsBytes(data, options.bytes)) {
    const bytes = byteView(data);
    const bits = new Uint8Array(bytes.length * 8);
    let bitIndex = 0;
    for (let i = 0; i < bytes.length; i++) {
      const byte = bytes[i];
      for (let bit = 0; bit < 8; bit++) {
        const shift = bitOrder === 'msb' ? 7 - bit : bit;
        bits[bitIndex] = (byte >> shift) & 1;
        bitIndex += 1;
      }
    }
    return bits;
  }

  if (!data || typeof data[Symbol.iterator] !== 'function') {
    throw new TypeError('bit data must be an ArrayBuffer, ArrayBuffer view, or iterable bit values');
  }

  const values = [];
  let index = 0;
  for (const value of data) {
    if (typeof value === 'boolean') {
      values.push(value ? 1 : 0);
    } else if (Number.isInteger(value) && (value === 0 || value === 1)) {
      values.push(value);
    } else {
      throw new RangeError(`bit value at index ${index} must be boolean or integer 0/1`);
    }
    index += 1;
  }
  return Uint8Array.from(values);
}

function jointHistogramMargins(jointHistogram, xSymbolCount, ySymbolCount) {
  const xCount = assertPositiveInteger(xSymbolCount, 'xSymbolCount');
  const yCount = assertPositiveInteger(ySymbolCount, 'ySymbolCount');
  if (!jointHistogram || jointHistogram.length !== xCount * yCount) {
    throw new RangeError('joint histogram length must equal xSymbolCount * ySymbolCount');
  }

  const total = histogramSampleCount(jointHistogram);
  const xMarginal = new Float64Array(xCount);
  const yMarginal = new Float64Array(yCount);
  for (let y = 0; y < yCount; y++) {
    for (let x = 0; x < xCount; x++) {
      const count = Number(jointHistogram[y * xCount + x]);
      xMarginal[x] += count;
      yMarginal[y] += count;
    }
  }
  return { xCount, yCount, total, xMarginal, yMarginal };
}

function sampleValueSequence(data, options = {}) {
  const mode = options.sampleMode ?? options.mode ?? (options.bits ? 'bits' : 'bytes');
  if (mode === 'bits') {
    return {
      values: bitSequence(data, options),
      symbolCount: 2,
      mode,
      symbolBits: 1,
    };
  }
  if (mode === 'bytes') {
    return {
      values: byteView(data),
      symbolCount: 256,
      mode,
      symbolBits: 8,
    };
  }
  throw new RangeError("sampleMode must be 'bits' or 'bytes'");
}

function histogramForSampleValues(values, symbolCount) {
  const histogram = new Uint32Array(symbolCount);
  for (let i = 0; i < values.length; i++) {
    const value = values[i];
    if (!Number.isInteger(value) || value < 0 || value >= symbolCount) {
      throw new RangeError(`sample value at index ${i} must be an integer in [0, ${symbolCount - 1}]`);
    }
    histogram[value] += 1;
  }
  return histogram;
}

function assertProbability(value, name) {
  if (!Number.isFinite(value) || value <= 0 || value >= 1) {
    throw new RangeError(`${name} must be finite and inside (0, 1)`);
  }
  return value;
}

function repetitionCutoffForEntropy(minEntropyBitsPerSample, falsePositiveProbability) {
  const entropy = finiteNonnegative(minEntropyBitsPerSample, 'minEntropyBitsPerSample');
  const probability = assertProbability(falsePositiveProbability, 'falsePositiveProbability');
  if (entropy === 0) return Infinity;
  return 1 + Math.ceil(-Math.log2(probability) / entropy);
}

function adaptiveCutoffForEntropy(windowSize, minEntropyBitsPerSample, falsePositiveProbability) {
  const window = assertPositiveInteger(windowSize, 'windowSize');
  const entropy = finiteNonnegative(minEntropyBitsPerSample, 'minEntropyBitsPerSample');
  const probability = assertProbability(falsePositiveProbability, 'falsePositiveProbability');
  if (entropy === 0) return window + 1;
  const expectedProbability = Math.min(1, Math.pow(2, -entropy / 2));
  const falsePositiveAllowance = Math.ceil(-Math.log2(probability));
  return Math.min(window + 1, Math.max(1, Math.ceil(window * expectedProbability) + falsePositiveAllowance));
}

function randomnessHealthLabel(score, sampleCount) {
  if (sampleCount === 0) return 'empty';
  if (score <= 0.15) return 'high';
  if (score <= 0.35) return 'medium';
  return 'low';
}

function mean(values) {
  return statsMean(values);
}

function extrema(values) {
  if (values.length === 0) return { min: 0, max: 0, range: 0 };
  let min = values[0];
  let max = values[0];
  for (let i = 1; i < values.length; i++) {
    min = Math.min(min, values[i]);
    max = Math.max(max, values[i]);
  }
  return { min, max, range: max - min };
}

export function byteFrequencyHistogram(data, histogram = new Uint32Array(256)) {
  if (!histogram || histogram.length < 256) {
    throw new RangeError('byte histogram must have at least 256 bins');
  }

  histogram.fill(0, 0, 256);
  const bytes = byteView(data);
  for (let i = 0; i < bytes.length; i++) {
    histogram[bytes[i]] += 1;
  }
  return histogram;
}

export function symbolFrequencyHistogram(values, symbolCount, histogram = new Uint32Array(symbolCount)) {
  const count = assertPositiveInteger(symbolCount, 'symbolCount');
  if (!histogram || histogram.length < count) {
    throw new RangeError('symbol histogram is smaller than symbolCount');
  }
  if (!values || typeof values[Symbol.iterator] !== 'function') {
    throw new TypeError('symbol values must be iterable');
  }

  histogram.fill(0, 0, count);
  let index = 0;
  for (const value of values) {
    if (!Number.isInteger(value) || value < 0 || value >= count) {
      throw new RangeError(`symbol value at index ${index} must be an integer in [0, ${count - 1}]`);
    }
    histogram[value] += 1;
    index += 1;
  }
  return histogram;
}

export function histogramSampleCount(histogram) {
  let total = 0;
  for (let i = 0; i < histogram.length; i++) {
    total += finiteNonnegative(Number(histogram[i]), `histogram[${i}]`);
  }
  return total;
}

export function histogramUniqueCount(histogram) {
  let unique = 0;
  for (let i = 0; i < histogram.length; i++) {
    if (finiteNonnegative(Number(histogram[i]), `histogram[${i}]`) > 0) unique += 1;
  }
  return unique;
}

export function probabilityTableFromHistogram(histogram, sampleCount = histogramSampleCount(histogram)) {
  const total = finiteNonnegative(sampleCount, 'sampleCount');
  const probabilities = new Float64Array(histogram.length);
  if (total === 0) return probabilities;
  for (let i = 0; i < histogram.length; i++) {
    probabilities[i] = finiteNonnegative(Number(histogram[i]), `histogram[${i}]`) / total;
  }
  return probabilities;
}

export function shannonEntropyFromHistogram(histogram, options = {}) {
  const base = assertLogBase(options.base ?? DEFAULT_LOG_BASE);
  const total = histogramSampleCount(histogram);
  if (total === 0) return 0;

  let entropy = 0;
  for (let i = 0; i < histogram.length; i++) {
    const count = Number(histogram[i]);
    if (count <= 0) continue;
    const p = count / total;
    entropy -= p * logBase(p, base);
  }
  return entropy;
}

export function minEntropyFromHistogram(histogram, options = {}) {
  const base = assertLogBase(options.base ?? DEFAULT_LOG_BASE);
  const total = histogramSampleCount(histogram);
  if (total === 0) return 0;

  let maxCount = 0;
  for (let i = 0; i < histogram.length; i++) {
    maxCount = Math.max(maxCount, Number(histogram[i]));
  }
  return -logBase(maxCount / total, base);
}

export function maxEntropyForSymbolCount(symbolCount, options = {}) {
  const count = assertPositiveInteger(symbolCount, 'symbolCount');
  const base = assertLogBase(options.base ?? DEFAULT_LOG_BASE);
  return count > 1 ? logBase(count, base) : 0;
}

export function collisionProbabilityFromHistogram(histogram) {
  const total = histogramSampleCount(histogram);
  if (total === 0) return 0;

  let probability = 0;
  for (let i = 0; i < histogram.length; i++) {
    const p = Number(histogram[i]) / total;
    probability += p * p;
  }
  return probability;
}

export function klDivergence(pDistribution, qDistribution, options = {}) {
  if (!pDistribution || !qDistribution || pDistribution.length !== qDistribution.length) {
    throw new RangeError('KL divergence distributions must have matching lengths');
  }

  const base = assertLogBase(options.base ?? DEFAULT_LOG_BASE);
  const smoothing = finiteNonnegative(options.smoothing ?? 0, 'smoothing');
  const pValues = new Float64Array(pDistribution.length);
  const qValues = new Float64Array(qDistribution.length);
  let pTotal = 0;
  let qTotal = 0;
  for (let i = 0; i < pDistribution.length; i++) {
    pValues[i] = finiteNonnegative(Number(pDistribution[i]), `pDistribution[${i}]`);
    qValues[i] = finiteNonnegative(Number(qDistribution[i]), `qDistribution[${i}]`);
    pTotal += pValues[i] + smoothing;
    qTotal += qValues[i] + smoothing;
  }
  if (pTotal === 0) return 0;
  if (qTotal === 0) return Infinity;

  let divergence = 0;
  for (let i = 0; i < pDistribution.length; i++) {
    const p = (pValues[i] + smoothing) / pTotal;
    const q = (qValues[i] + smoothing) / qTotal;
    if (p === 0) continue;
    if (q === 0) return Infinity;
    divergence += p * logBase(p / q, base);
  }
  return divergence;
}

export function crossEntropy(pDistribution, qDistribution, options = {}) {
  if (!pDistribution || !qDistribution || pDistribution.length !== qDistribution.length) {
    throw new RangeError('cross entropy distributions must have matching lengths');
  }

  const base = assertLogBase(options.base ?? DEFAULT_LOG_BASE);
  const smoothing = finiteNonnegative(options.smoothing ?? 0, 'smoothing');
  const p = normalizedDistribution(pDistribution, 'pDistribution', smoothing);
  const q = normalizedDistribution(qDistribution, 'qDistribution', smoothing);
  if (p.total === 0) return 0;
  if (q.total === 0) return Infinity;

  let entropy = 0;
  for (let i = 0; i < p.values.length; i++) {
    const pValue = p.values[i] / p.total;
    const qValue = q.values[i] / q.total;
    if (pValue === 0) continue;
    if (qValue === 0) return Infinity;
    entropy -= pValue * logBase(qValue, base);
  }
  return entropy;
}

export function mutualInformationFromJointHistogram(jointHistogram, xSymbolCount, ySymbolCount, options = {}) {
  const xCount = assertPositiveInteger(xSymbolCount, 'xSymbolCount');
  const yCount = assertPositiveInteger(ySymbolCount, 'ySymbolCount');
  if (!jointHistogram || jointHistogram.length !== xCount * yCount) {
    throw new RangeError('joint histogram length must equal xSymbolCount * ySymbolCount');
  }

  const base = assertLogBase(options.base ?? DEFAULT_LOG_BASE);
  const total = histogramSampleCount(jointHistogram);
  if (total === 0) return 0;

  const px = new Float64Array(xCount);
  const py = new Float64Array(yCount);
  for (let y = 0; y < yCount; y++) {
    for (let x = 0; x < xCount; x++) {
      const count = Number(jointHistogram[y * xCount + x]);
      px[x] += count;
      py[y] += count;
    }
  }

  let information = 0;
  for (let y = 0; y < yCount; y++) {
    for (let x = 0; x < xCount; x++) {
      const joint = Number(jointHistogram[y * xCount + x]);
      if (joint <= 0) continue;
      const pxy = joint / total;
      const expected = (px[x] / total) * (py[y] / total);
      information += pxy * logBase(pxy / expected, base);
    }
  }
  return information;
}

export function conditionalEntropyFromJointHistogram(jointHistogram, xSymbolCount, ySymbolCount, options = {}) {
  const base = assertLogBase(options.base ?? DEFAULT_LOG_BASE);
  const given = options.given ?? 'x';
  if (given !== 'x' && given !== 'y') {
    throw new RangeError("given must be 'x' for H(Y|X) or 'y' for H(X|Y)");
  }

  const { xCount, yCount, total, xMarginal, yMarginal } = jointHistogramMargins(jointHistogram, xSymbolCount, ySymbolCount);
  if (total === 0) return 0;

  let entropy = 0;
  for (let y = 0; y < yCount; y++) {
    for (let x = 0; x < xCount; x++) {
      const joint = Number(jointHistogram[y * xCount + x]);
      if (joint <= 0) continue;
      const pxy = joint / total;
      const conditioning = given === 'x' ? xMarginal[x] / total : yMarginal[y] / total;
      entropy -= pxy * logBase(pxy / conditioning, base);
    }
  }
  return entropy;
}

export function jointEntropyReport(jointHistogram, xSymbolCount, ySymbolCount, options = {}) {
  const base = assertLogBase(options.base ?? DEFAULT_LOG_BASE);
  const { xCount, yCount, total, xMarginal, yMarginal } = jointHistogramMargins(jointHistogram, xSymbolCount, ySymbolCount);
  const jointEntropy = shannonEntropyFromHistogram(jointHistogram, { base });
  const xEntropy = shannonEntropyFromHistogram(xMarginal, { base });
  const yEntropy = shannonEntropyFromHistogram(yMarginal, { base });
  const conditionalYGivenX = conditionalEntropyFromJointHistogram(jointHistogram, xCount, yCount, { base, given: 'x' });
  const conditionalXGivenY = conditionalEntropyFromJointHistogram(jointHistogram, xCount, yCount, { base, given: 'y' });
  const mutualInformation = mutualInformationFromJointHistogram(jointHistogram, xCount, yCount, { base });
  const normalizer = Math.min(xEntropy, yEntropy);

  return {
    sampleCount: total,
    xSymbolCount: xCount,
    ySymbolCount: yCount,
    jointEntropy,
    xEntropy,
    yEntropy,
    conditionalYGivenX,
    conditionalXGivenY,
    mutualInformation,
    normalizedMutualInformation: normalizer > 0 ? mutualInformation / normalizer : 0,
    xMarginal,
    yMarginal,
    xProbabilities: probabilityTableFromHistogram(xMarginal, total),
    yProbabilities: probabilityTableFromHistogram(yMarginal, total),
    jointProbabilities: probabilityTableFromHistogram(jointHistogram, total),
  };
}

export function bitRunReport(data, options = {}) {
  const bits = bitSequence(data, options);
  const bitCount = bits.length;
  if (bitCount === 0) {
    return {
      valid: false,
      bitCount: 0,
      ones: 0,
      zeros: 0,
      oneProportion: 0,
      zeroProportion: 0,
      runCount: 0,
      expectedRunCount: 0,
      runDelta: 0,
      longestZeroRun: 0,
      longestOneRun: 0,
      zeroRunHistogram: new Uint32Array(1),
      oneRunHistogram: new Uint32Array(1),
      tau: Infinity,
      monobitPrerequisitePassed: false,
      nistRunsApplicable: false,
      oscillation: 'empty',
    };
  }

  let ones = 0;
  let runCount = 1;
  let longestZeroRun = 0;
  let longestOneRun = 0;
  const zeroRunHistogram = new Uint32Array(bitCount + 1);
  const oneRunHistogram = new Uint32Array(bitCount + 1);

  function recordRun(bit, length) {
    if (bit === 1) {
      oneRunHistogram[length] += 1;
      longestOneRun = Math.max(longestOneRun, length);
    } else {
      zeroRunHistogram[length] += 1;
      longestZeroRun = Math.max(longestZeroRun, length);
    }
  }

  let currentBit = bits[0];
  let currentLength = 0;
  for (let i = 0; i < bitCount; i++) {
    const bit = bits[i];
    if (bit === 1) ones += 1;
    if (bit === currentBit) {
      currentLength += 1;
    } else {
      recordRun(currentBit, currentLength);
      currentBit = bit;
      currentLength = 1;
      runCount += 1;
    }
  }
  recordRun(currentBit, currentLength);

  const zeros = bitCount - ones;
  const oneProportion = ones / bitCount;
  const zeroProportion = zeros / bitCount;
  const expectedRunCount = 1 + (2 * ones * zeros) / bitCount;
  const runDelta = runCount - expectedRunCount;
  const tau = 2 / Math.sqrt(bitCount);
  const monobitPrerequisitePassed = Math.abs(oneProportion - 0.5) < tau;
  const oscillation = Math.abs(runDelta) <= Number.EPSILON ? 'expected' : runDelta > 0 ? 'fast' : 'slow';

  return {
    valid: true,
    bitCount,
    ones,
    zeros,
    oneProportion,
    zeroProportion,
    runCount,
    expectedRunCount,
    runDelta,
    longestZeroRun,
    longestOneRun,
    zeroRunHistogram: zeroRunHistogram.slice(0, longestZeroRun + 1),
    oneRunHistogram: oneRunHistogram.slice(0, longestOneRun + 1),
    tau,
    monobitPrerequisitePassed,
    nistRunsApplicable: monobitPrerequisitePassed,
    oscillation,
  };
}

export function monobitRatio(data, options = {}) {
  const bits = bitSequence(data, options);
  const bitCount = bits.length;
  if (bitCount === 0) {
    return {
      valid: false,
      bitCount: 0,
      ones: 0,
      zeros: 0,
      oneRatio: 0,
      zeroRatio: 0,
      imbalance: 0,
      absoluteDeviation: 0,
      normalizedSum: 0,
      tau: Infinity,
      balanced: false,
    };
  }

  let ones = 0;
  for (let i = 0; i < bitCount; i++) {
    if (bits[i] === 1) ones += 1;
  }
  const zeros = bitCount - ones;
  const oneRatio = ones / bitCount;
  const zeroRatio = zeros / bitCount;
  const imbalance = oneRatio - 0.5;
  const absoluteDeviation = Math.abs(imbalance);
  const normalizedSum = (ones - zeros) / Math.sqrt(bitCount);
  const tau = 2 / Math.sqrt(bitCount);
  const maxDeviation = finiteNonnegative(options.maxDeviation ?? tau, 'maxDeviation');

  return {
    valid: true,
    bitCount,
    ones,
    zeros,
    oneRatio,
    zeroRatio,
    imbalance,
    absoluteDeviation,
    normalizedSum,
    tau,
    balanced: absoluteDeviation <= maxDeviation,
  };
}

export function byteDistributionReport(data, options = {}) {
  const histogram = byteFrequencyHistogram(data);
  const report = histogramEntropyReport(histogram, {
    symbolCount: 256,
    base: options.base ?? DEFAULT_LOG_BASE,
    symbolBits: 8,
  });
  const expectedCount = report.sampleCount > 0 ? report.sampleCount / 256 : 0;
  let chiSquare = 0;
  let maxBinDeviation = 0;
  let maxBinDeviationSymbol = -1;
  for (let i = 0; i < histogram.length; i++) {
    const deviation = Math.abs(Number(histogram[i]) - expectedCount);
    if (deviation > maxBinDeviation) {
      maxBinDeviation = deviation;
      maxBinDeviationSymbol = i;
    }
    if (expectedCount > 0) {
      chiSquare += (deviation * deviation) / expectedCount;
    }
  }

  return {
    ...report,
    expectedCount,
    chiSquare,
    maxBinDeviation,
    maxBinDeviationSymbol,
    maxBinDeviationRatio: expectedCount > 0 ? maxBinDeviation / expectedCount : 0,
    occupiedBinRatio: report.uniqueSymbolCount / 256,
    histogram,
  };
}

export function collisionCount(data, options = {}) {
  const { values, symbolCount, mode } = sampleValueSequence(data, options);
  const histogram = histogramForSampleValues(values, symbolCount);
  const sampleCount = values.length;
  const uniqueSymbolCount = histogramUniqueCount(histogram);
  let collisionPairs = 0;
  for (let i = 0; i < histogram.length; i++) {
    const count = Number(histogram[i]);
    collisionPairs += (count * (count - 1)) / 2;
  }
  const possiblePairs = (sampleCount * (sampleCount - 1)) / 2;

  return {
    sampleMode: mode,
    sampleCount,
    uniqueSymbolCount,
    duplicateCount: sampleCount - uniqueSymbolCount,
    collisionPairs,
    possiblePairs,
    collisionRatio: possiblePairs > 0 ? collisionPairs / possiblePairs : 0,
    collisionProbability: collisionProbabilityFromHistogram(histogram),
    histogram,
  };
}

export function serialCorrelation(data, options = {}) {
  const { values, mode } = sampleValueSequence(data, options);
  const lag = assertPositiveInteger(options.lag ?? 1, 'lag');
  const pairCount = Math.max(0, values.length - lag);
  if (pairCount === 0) {
    return {
      valid: false,
      sampleMode: mode,
      sampleCount: values.length,
      lag,
      pairCount: 0,
      coefficient: 0,
      covariance: 0,
      varianceA: 0,
      varianceB: 0,
      meanA: 0,
      meanB: 0,
    };
  }

  let meanA = 0;
  let meanB = 0;
  for (let i = 0; i < pairCount; i++) {
    meanA += values[i];
    meanB += values[i + lag];
  }
  meanA /= pairCount;
  meanB /= pairCount;

  let covariance = 0;
  let varianceA = 0;
  let varianceB = 0;
  for (let i = 0; i < pairCount; i++) {
    const da = values[i] - meanA;
    const db = values[i + lag] - meanB;
    covariance += da * db;
    varianceA += da * da;
    varianceB += db * db;
  }
  covariance /= pairCount;
  varianceA /= pairCount;
  varianceB /= pairCount;
  const denominator = Math.sqrt(varianceA * varianceB);

  return {
    valid: true,
    sampleMode: mode,
    sampleCount: values.length,
    lag,
    pairCount,
    coefficient: denominator > 0 ? covariance / denominator : 0,
    covariance,
    varianceA,
    varianceB,
    meanA,
    meanB,
  };
}

export function repetitionCount(data, options = {}) {
  const { values, symbolCount, mode, symbolBits } = sampleValueSequence(data, options);
  const sampleCount = values.length;
  const histogram = histogramForSampleValues(values, symbolCount);
  const minEntropyBitsPerSample = options.minEntropyBitsPerSample ?? minEntropyFromHistogram(histogram);
  const falsePositiveProbability = options.falsePositiveProbability ?? DEFAULT_HEALTH_FALSE_POSITIVE_PROBABILITY;
  const cutoff = options.cutoff ?? repetitionCutoffForEntropy(minEntropyBitsPerSample, falsePositiveProbability);
  if (sampleCount === 0) {
    return {
      valid: false,
      sampleMode: mode,
      sampleCount: 0,
      symbolBits,
      minEntropyBitsPerSample,
      falsePositiveProbability,
      cutoff,
      longestRun: 0,
      longestRunSymbol: -1,
      violationCount: 0,
      passed: false,
    };
  }

  let longestRun = 1;
  let longestRunSymbol = values[0];
  let currentSymbol = values[0];
  let currentRun = 1;
  let violationCount = 0;
  for (let i = 1; i < sampleCount; i++) {
    if (values[i] === currentSymbol) {
      currentRun += 1;
    } else {
      if (currentRun >= cutoff) violationCount += 1;
      if (currentRun > longestRun) {
        longestRun = currentRun;
        longestRunSymbol = currentSymbol;
      }
      currentSymbol = values[i];
      currentRun = 1;
    }
  }
  if (currentRun >= cutoff) violationCount += 1;
  if (currentRun > longestRun) {
    longestRun = currentRun;
    longestRunSymbol = currentSymbol;
  }

  return {
    valid: true,
    sampleMode: mode,
    sampleCount,
    symbolBits,
    minEntropyBitsPerSample,
    falsePositiveProbability,
    cutoff,
    longestRun,
    longestRunSymbol,
    violationCount,
    passed: violationCount === 0,
  };
}

export function adaptiveProportionReport(data, options = {}) {
  const { values, symbolCount, mode } = sampleValueSequence(data, options);
  const sampleCount = values.length;
  const defaultWindowSize = symbolCount === 2 ? 1024 : 512;
  const configuredWindowSize = assertPositiveInteger(options.windowSize ?? defaultWindowSize, 'windowSize');
  const windowSize = sampleCount > 0 ? Math.min(configuredWindowSize, sampleCount) : configuredWindowSize;
  const histogram = histogramForSampleValues(values, symbolCount);
  const minEntropyBitsPerSample = options.minEntropyBitsPerSample ?? minEntropyFromHistogram(histogram);
  const falsePositiveProbability = options.falsePositiveProbability ?? DEFAULT_HEALTH_FALSE_POSITIVE_PROBABILITY;
  const cutoff = options.cutoff ?? adaptiveCutoffForEntropy(windowSize, minEntropyBitsPerSample, falsePositiveProbability);

  let windowCount = 0;
  let maxWindowCount = 0;
  let maxWindowSymbol = -1;
  let maxWindowStart = -1;
  let violationCount = 0;
  for (let start = 0; start < sampleCount; start += windowSize) {
    const end = Math.min(sampleCount, start + windowSize);
    const counts = new Uint32Array(symbolCount);
    for (let i = start; i < end; i++) {
      counts[values[i]] += 1;
    }
    windowCount += 1;
    for (let symbol = 0; symbol < counts.length; symbol++) {
      const count = counts[symbol];
      if (count > maxWindowCount) {
        maxWindowCount = count;
        maxWindowSymbol = symbol;
        maxWindowStart = start;
      }
    }
    if (counts.some((count) => count >= cutoff)) violationCount += 1;
  }

  return {
    valid: sampleCount > 0,
    sampleMode: mode,
    sampleCount,
    configuredWindowSize,
    windowSize,
    windowCount,
    minEntropyBitsPerSample,
    falsePositiveProbability,
    cutoff,
    maxWindowCount,
    maxWindowSymbol,
    maxWindowStart,
    maxWindowProportion: windowSize > 0 ? maxWindowCount / windowSize : 0,
    violationCount,
    passed: sampleCount > 0 && violationCount === 0,
  };
}

export function minEntropyThresholdReport(data, options = {}) {
  const { values, symbolCount, mode, symbolBits } = sampleValueSequence(data, options);
  const histogram = histogramForSampleValues(values, symbolCount);
  const minEntropyBitsPerSample = minEntropyFromHistogram(histogram);
  const requiredMinEntropyBitsPerSample = finiteNonnegative(
    options.requiredMinEntropyBitsPerSample ?? symbolBits * 0.75,
    'requiredMinEntropyBitsPerSample'
  );

  return {
    sampleMode: mode,
    sampleCount: values.length,
    symbolBits,
    minEntropyBitsPerSample,
    requiredMinEntropyBitsPerSample,
    normalizedMinEntropy: symbolBits > 0 ? minEntropyBitsPerSample / symbolBits : 0,
    marginBitsPerSample: minEntropyBitsPerSample - requiredMinEntropyBitsPerSample,
    passed: minEntropyBitsPerSample >= requiredMinEntropyBitsPerSample,
  };
}

export function predictabilityScore(data, options = {}) {
  const byteDistribution = byteDistributionReport(data, options);
  const monobit = monobitRatio(data, { ...options, bytes: options.bitBytes ?? true });
  const serial = serialCorrelation(data, options);
  const repetition = repetitionCount(data, options);
  const adaptive = adaptiveProportionReport(data, options);

  const entropyRisk = 1 - byteDistribution.normalizedEntropy;
  const monobitRisk = monobit.valid ? Math.min(1, monobit.absoluteDeviation / (options.monobitMaxDeviation ?? Math.max(monobit.tau, 0.01))) : 1;
  const serialRisk = serial.valid ? Math.min(1, Math.abs(serial.coefficient) / (options.serialMaxAbs ?? 0.25)) : 1;
  const repetitionRisk = Number.isFinite(repetition.cutoff) && repetition.cutoff > 0 ? Math.min(1, repetition.longestRun / repetition.cutoff) : 0;
  const adaptiveRisk = Number.isFinite(adaptive.cutoff) && adaptive.cutoff > 0 ? Math.min(1, adaptive.maxWindowCount / adaptive.cutoff) : 0;

  return Math.max(0, Math.min(1,
    entropyRisk * 0.3 +
    monobitRisk * 0.2 +
    serialRisk * 0.2 +
    repetitionRisk * 0.15 +
    adaptiveRisk * 0.15
  ));
}

export function randomnessHealthReport(data, options = {}) {
  const byteDistribution = byteDistributionReport(data, options);
  const monobit = monobitRatio(data, { ...options, bytes: options.bitBytes ?? true });
  const runs = bitRunReport(data, { ...options, bytes: options.bitBytes ?? true });
  const collisions = collisionCount(data, options);
  const serial = serialCorrelation(data, options);
  const repetition = repetitionCount(data, options);
  const adaptive = adaptiveProportionReport(data, options);
  const minEntropyThreshold = minEntropyThresholdReport(data, options);
  const score = predictabilityScore(data, options);

  return {
    sampleCount: byteDistribution.sampleCount,
    bitCount: monobit.bitCount,
    predictabilityScore: score,
    health: randomnessHealthLabel(score, byteDistribution.sampleCount),
    passed: minEntropyThreshold.passed && repetition.passed && adaptive.passed,
    byteDistribution,
    monobit,
    runs,
    collisions,
    serial,
    repetition,
    adaptive,
    minEntropyThreshold,
  };
}

export function entropyWindowReport(data, options = {}) {
  const { values, symbolCount, mode, symbolBits } = sampleValueSequence(data, options);
  const sampleCount = values.length;
  const configuredWindowSize = assertPositiveInteger(options.windowSize ?? Math.min(256, Math.max(1, sampleCount)), 'windowSize');
  const hopSize = assertPositiveInteger(options.hopSize ?? configuredWindowSize, 'hopSize');
  const base = assertLogBase(options.base ?? DEFAULT_LOG_BASE);
  const includePartial = options.includePartial ?? true;
  const windows = [];

  if (sampleCount === 0) {
    return {
      valid: false,
      sampleMode: mode,
      sampleCount: 0,
      symbolCount,
      symbolBits,
      windowSize: configuredWindowSize,
      hopSize,
      includePartial,
      windowCount: 0,
      windows,
    };
  }

  for (let start = 0; start < sampleCount; start += hopSize) {
    const end = Math.min(sampleCount, start + configuredWindowSize);
    if (end - start < configuredWindowSize && !includePartial) break;

    const histogram = new Uint32Array(symbolCount);
    for (let i = start; i < end; i++) {
      histogram[values[i]] += 1;
    }
    const report = histogramEntropyReport(histogram, {
      symbolCount,
      base,
      symbolBits,
    });
    windows.push({
      index: windows.length,
      start,
      end,
      sampleCount: end - start,
      entropy: report.entropy,
      entropyBitsPerSymbol: report.entropyBitsPerSymbol,
      minEntropy: report.minEntropy,
      normalizedEntropy: report.normalizedEntropy,
      redundancy: report.redundancy,
      collisionProbability: report.collisionProbability,
      health: report.health,
      mostCommon: report.mostCommon,
      leastCommonObserved: report.leastCommonObserved,
      probabilities: report.probabilities,
      histogram,
    });
    if (end === sampleCount) break;
  }

  return {
    valid: windows.length > 0,
    sampleMode: mode,
    sampleCount,
    symbolCount,
    symbolBits,
    windowSize: configuredWindowSize,
    hopSize,
    includePartial,
    windowCount: windows.length,
    windows,
  };
}

export function streamingEntropyHealthReport(data, options = {}) {
  const windowReport = entropyWindowReport(data, options);
  const minNormalizedEntropy = finiteNonnegative(options.minNormalizedEntropy ?? 0.75, 'minNormalizedEntropy');
  const maxEntropyDrop = finiteNonnegative(options.maxEntropyDrop ?? 0.25, 'maxEntropyDrop');
  const entropies = windowReport.windows.map((window) => window.entropy);
  const normalizedEntropies = windowReport.windows.map((window) => window.normalizedEntropy);
  const minEntropies = windowReport.windows.map((window) => window.minEntropy);
  const entropyStats = extrema(entropies);
  const normalizedEntropyStats = extrema(normalizedEntropies);
  const minEntropyStats = extrema(minEntropies);
  let maxAdjacentEntropyDrop = 0;
  let maxAdjacentEntropyRise = 0;
  let maxAdjacentEntropyDelta = 0;
  let unstableWindowCount = 0;
  let lowEntropyWindowCount = 0;

  for (let i = 0; i < windowReport.windows.length; i++) {
    if (windowReport.windows[i].normalizedEntropy < minNormalizedEntropy) {
      lowEntropyWindowCount += 1;
    }
    if (i === 0) continue;
    const delta = windowReport.windows[i].normalizedEntropy - windowReport.windows[i - 1].normalizedEntropy;
    maxAdjacentEntropyDrop = Math.max(maxAdjacentEntropyDrop, -delta);
    maxAdjacentEntropyRise = Math.max(maxAdjacentEntropyRise, delta);
    maxAdjacentEntropyDelta = Math.max(maxAdjacentEntropyDelta, Math.abs(delta));
    if (Math.abs(delta) > maxEntropyDrop) unstableWindowCount += 1;
  }

  const healthScore = windowReport.windowCount === 0
    ? 1
    : Math.min(1, (lowEntropyWindowCount / windowReport.windowCount) * 0.6 + Math.min(1, maxAdjacentEntropyDelta / Math.max(maxEntropyDrop, Number.EPSILON)) * 0.4);

  return {
    valid: windowReport.valid,
    sampleMode: windowReport.sampleMode,
    sampleCount: windowReport.sampleCount,
    windowSize: windowReport.windowSize,
    hopSize: windowReport.hopSize,
    windowCount: windowReport.windowCount,
    minNormalizedEntropy,
    maxEntropyDrop,
    entropyMean: mean(entropies),
    minEntropyMean: mean(minEntropies),
    normalizedEntropyMean: mean(normalizedEntropies),
    entropyMin: entropyStats.min,
    entropyMax: entropyStats.max,
    entropyRange: entropyStats.range,
    minEntropyMin: minEntropyStats.min,
    minEntropyMax: minEntropyStats.max,
    minEntropyRange: minEntropyStats.range,
    normalizedEntropyMin: normalizedEntropyStats.min,
    normalizedEntropyMax: normalizedEntropyStats.max,
    normalizedEntropyRange: normalizedEntropyStats.range,
    maxAdjacentEntropyDrop,
    maxAdjacentEntropyRise,
    maxAdjacentEntropyDelta,
    lowEntropyWindowCount,
    unstableWindowCount,
    healthScore,
    health: randomnessHealthLabel(healthScore, windowReport.sampleCount),
    passed: windowReport.valid && lowEntropyWindowCount === 0 && unstableWindowCount === 0,
    windows: windowReport.windows,
  };
}

export function entropyCompressionEstimate(sampleCount, entropyBitsPerSymbol, options = {}) {
  const samples = finiteNonnegative(sampleCount, 'sampleCount');
  const entropyBits = finiteNonnegative(entropyBitsPerSymbol, 'entropyBitsPerSymbol');
  const symbolBits = finiteNonnegative(options.symbolBits ?? DEFAULT_SYMBOL_BITS, 'symbolBits');
  const rawBits = samples * symbolBits;
  const lowerBoundBits = samples * entropyBits;
  return {
    sampleCount: samples,
    rawBits,
    rawBytes: Math.ceil(rawBits / 8),
    lowerBoundBits,
    lowerBoundBytes: Math.ceil(lowerBoundBits / 8),
    idealCompressionRatio: rawBits > 0 ? lowerBoundBits / rawBits : 0,
    possibleSavingsRatio: rawBits > 0 ? Math.max(0, 1 - lowerBoundBits / rawBits) : 0,
  };
}

function histogramExtrema(histogram, total) {
  let mostCommon = { symbol: -1, count: 0, probability: 0 };
  let leastCommonObserved = { symbol: -1, count: 0, probability: 0 };
  for (let i = 0; i < histogram.length; i++) {
    const count = Number(histogram[i]);
    if (count > mostCommon.count) {
      mostCommon = { symbol: i, count, probability: total > 0 ? count / total : 0 };
    }
    if (count > 0 && (leastCommonObserved.symbol === -1 || count < leastCommonObserved.count)) {
      leastCommonObserved = { symbol: i, count, probability: total > 0 ? count / total : 0 };
    }
  }
  return { mostCommon, leastCommonObserved };
}

function entropyHealthLabel(normalizedEntropy, sampleCount) {
  if (sampleCount === 0) return 'empty';
  if (normalizedEntropy >= 0.95) return 'high';
  if (normalizedEntropy >= 0.75) return 'medium';
  return 'low';
}

export function histogramEntropyReport(histogram, options = {}) {
  const symbolCount = assertPositiveInteger(options.symbolCount ?? histogram.length, 'symbolCount');
  const base = assertLogBase(options.base ?? DEFAULT_LOG_BASE);
  const symbolBits = finiteNonnegative(options.symbolBits ?? DEFAULT_SYMBOL_BITS, 'symbolBits');
  const sampleCount = histogramSampleCount(histogram);
  const uniqueSymbolCount = histogramUniqueCount(histogram);
  if (symbolCount < uniqueSymbolCount) {
    throw new RangeError('symbolCount must be at least the observed unique symbol count');
  }
  const entropy = shannonEntropyFromHistogram(histogram, { base });
  const minEntropy = minEntropyFromHistogram(histogram, { base });
  const maxEntropy = maxEntropyForSymbolCount(symbolCount, { base });
  const normalizedEntropy = maxEntropy > 0 ? entropy / maxEntropy : 0;
  const collisionProbability = collisionProbabilityFromHistogram(histogram);
  const compression = entropyCompressionEstimate(sampleCount, entropy, { symbolBits });

  return {
    sampleCount,
    symbolCount,
    uniqueSymbolCount,
    entropy,
    entropyBitsPerSymbol: base === 2 ? entropy : entropy * logBase(base, 2),
    minEntropy,
    maxEntropy,
    normalizedEntropy,
    redundancy: Math.max(0, 1 - normalizedEntropy),
    collisionProbability,
    health: entropyHealthLabel(normalizedEntropy, sampleCount),
    compression,
    probabilities: probabilityTableFromHistogram(histogram, sampleCount),
    ...histogramExtrema(histogram, sampleCount),
  };
}

export function entropyReport(data, options = {}) {
  const histogram = byteFrequencyHistogram(data);
  return histogramEntropyReport(histogram, {
    symbolCount: options.symbolCount ?? 256,
    base: options.base ?? DEFAULT_LOG_BASE,
    symbolBits: options.symbolBits ?? DEFAULT_SYMBOL_BITS,
  });
}

export default {
  byteFrequencyHistogram,
  symbolFrequencyHistogram,
  histogramSampleCount,
  histogramUniqueCount,
  probabilityTableFromHistogram,
  shannonEntropyFromHistogram,
  minEntropyFromHistogram,
  maxEntropyForSymbolCount,
  collisionProbabilityFromHistogram,
  klDivergence,
  crossEntropy,
  mutualInformationFromJointHistogram,
  conditionalEntropyFromJointHistogram,
  jointEntropyReport,
  bitRunReport,
  monobitRatio,
  byteDistributionReport,
  collisionCount,
  serialCorrelation,
  repetitionCount,
  adaptiveProportionReport,
  minEntropyThresholdReport,
  predictabilityScore,
  randomnessHealthReport,
  entropyWindowReport,
  streamingEntropyHealthReport,
  entropyCompressionEstimate,
  histogramEntropyReport,
  entropyReport,
};
