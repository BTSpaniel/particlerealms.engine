// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

// LossyCompressionMath.js - pure transform, quantization, and reconstruction reports.

import {
  meanSquaredError,
  pairwiseErrorStats,
  peakSignalToNoiseRatio,
} from './MathQuality.js';

const DEFAULT_BLOCK_WIDTH = 8;
const DEFAULT_BLOCK_HEIGHT = 8;
const DEFAULT_DATA_RANGE = 255;

function finiteNumber(value, name) {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    throw new RangeError(`${name} must be finite`);
  }
  return number;
}

function positiveFinite(value, name) {
  const number = finiteNumber(value, name);
  if (number <= 0) {
    throw new RangeError(`${name} must be positive`);
  }
  return number;
}

function positiveInteger(value, name) {
  const number = finiteNumber(value, name);
  if (!Number.isInteger(number) || number <= 0) {
    throw new RangeError(`${name} must be a positive integer`);
  }
  return number;
}

function numericArray(values, name = 'values') {
  if (!values || typeof values.length !== 'number') {
    throw new TypeError(`${name} must be array-like`);
  }
  const result = new Float64Array(values.length);
  for (let index = 0; index < values.length; index++) {
    result[index] = finiteNumber(values[index], `${name}[${index}]`);
  }
  return result;
}

function blockShape(options = {}) {
  const width = positiveInteger(options.width ?? DEFAULT_BLOCK_WIDTH, 'width');
  const height = positiveInteger(options.height ?? DEFAULT_BLOCK_HEIGHT, 'height');
  return { width, height, count: width * height };
}

function quantizerAt(quantization, index) {
  if (typeof quantization === 'number') return positiveFinite(quantization, 'quantization');
  if (!quantization || typeof quantization.length !== 'number') {
    throw new TypeError('quantization must be a positive number or array-like table');
  }
  if (index >= quantization.length) {
    throw new RangeError('quantization table is smaller than the coefficient count');
  }
  return positiveFinite(quantization[index], `quantization[${index}]`);
}

function maybeClamp(value, min, max) {
  let next = value;
  if (min !== null && next < min) next = min;
  if (max !== null && next > max) next = max;
  return next;
}

function sumSquares(values) {
  let total = 0;
  for (let index = 0; index < values.length; index++) {
    total += values[index] * values[index];
  }
  return total;
}

export function lossyDct1D(values) {
  const source = numericArray(values);
  const count = source.length;
  const output = new Float64Array(count);
  if (count === 0) return output;

  const scale0 = Math.sqrt(1 / count);
  const scale = Math.sqrt(2 / count);
  for (let k = 0; k < count; k++) {
    let sum = 0;
    for (let n = 0; n < count; n++) {
      sum += source[n] * Math.cos((Math.PI / count) * (n + 0.5) * k);
    }
    output[k] = (k === 0 ? scale0 : scale) * sum;
  }
  return output;
}

export function lossyIdct1D(coefficients) {
  const source = numericArray(coefficients, 'coefficients');
  const count = source.length;
  const output = new Float64Array(count);
  if (count === 0) return output;

  const scale0 = Math.sqrt(1 / count);
  const scale = Math.sqrt(2 / count);
  for (let n = 0; n < count; n++) {
    let sum = 0;
    for (let k = 0; k < count; k++) {
      sum += (k === 0 ? scale0 : scale) * source[k] * Math.cos((Math.PI / count) * (n + 0.5) * k);
    }
    output[n] = sum;
  }
  return output;
}

export function lossyDct2D(values, options = {}) {
  const { width, height, count } = blockShape(options);
  const source = numericArray(values);
  if (source.length !== count) {
    throw new RangeError('values length must equal width * height');
  }

  const rowTransformed = new Float64Array(count);
  for (let y = 0; y < height; y++) {
    const row = lossyDct1D(source.subarray(y * width, y * width + width));
    rowTransformed.set(row, y * width);
  }

  const output = new Float64Array(count);
  const column = new Float64Array(height);
  for (let x = 0; x < width; x++) {
    for (let y = 0; y < height; y++) column[y] = rowTransformed[y * width + x];
    const transformed = lossyDct1D(column);
    for (let y = 0; y < height; y++) output[y * width + x] = transformed[y];
  }
  return output;
}

export function lossyIdct2D(coefficients, options = {}) {
  const { width, height, count } = blockShape(options);
  const source = numericArray(coefficients, 'coefficients');
  if (source.length !== count) {
    throw new RangeError('coefficients length must equal width * height');
  }

  const columnTransformed = new Float64Array(count);
  const column = new Float64Array(height);
  for (let x = 0; x < width; x++) {
    for (let y = 0; y < height; y++) column[y] = source[y * width + x];
    const transformed = lossyIdct1D(column);
    for (let y = 0; y < height; y++) columnTransformed[y * width + x] = transformed[y];
  }

  const output = new Float64Array(count);
  for (let y = 0; y < height; y++) {
    const row = lossyIdct1D(columnTransformed.subarray(y * width, y * width + width));
    output.set(row, y * width);
  }
  return output;
}

export function lossyZigZagIndices(width = DEFAULT_BLOCK_WIDTH, height = DEFAULT_BLOCK_HEIGHT) {
  const blockWidth = positiveInteger(width, 'width');
  const blockHeight = positiveInteger(height, 'height');
  const indices = [];
  for (let diagonal = 0; diagonal <= blockWidth + blockHeight - 2; diagonal++) {
    const run = [];
    for (let y = 0; y < blockHeight; y++) {
      const x = diagonal - y;
      if (x >= 0 && x < blockWidth) run.push(y * blockWidth + x);
    }
    if (diagonal % 2 === 0) run.reverse();
    indices.push(...run);
  }
  return indices;
}

export function lossyQuantizeCoefficients(coefficients, quantization = 1) {
  const source = numericArray(coefficients, 'coefficients');
  const quantized = new Int32Array(source.length);
  const dequantized = new Float64Array(source.length);
  let zeroCount = 0;
  let maxAbsQuantized = 0;

  for (let index = 0; index < source.length; index++) {
    const step = quantizerAt(quantization, index);
    const value = Math.round(source[index] / step);
    quantized[index] = value;
    dequantized[index] = value * step;
    if (value === 0) zeroCount++;
    maxAbsQuantized = Math.max(maxAbsQuantized, Math.abs(value));
  }

  return {
    coefficientCount: source.length,
    quantized,
    dequantized,
    zeroCount,
    nonzeroCount: source.length - zeroCount,
    zeroRatio: source.length > 0 ? zeroCount / source.length : 0,
    maxAbsQuantized,
  };
}

export function lossyScalarQuantizationReport(values, options = {}) {
  const source = numericArray(values);
  const step = positiveFinite(options.step ?? 1, 'step');
  const dataRange = positiveFinite(options.dataRange ?? DEFAULT_DATA_RANGE, 'dataRange');
  const clampMin = options.clampMin === undefined ? null : finiteNumber(options.clampMin, 'clampMin');
  const clampMax = options.clampMax === undefined ? null : finiteNumber(options.clampMax, 'clampMax');
  const quantized = new Int32Array(source.length);
  const reconstructed = new Float64Array(source.length);
  let zeroCount = 0;

  for (let index = 0; index < source.length; index++) {
    const q = Math.round(source[index] / step);
    quantized[index] = q;
    reconstructed[index] = maybeClamp(q * step, clampMin, clampMax);
    if (q === 0) zeroCount++;
  }

  const errors = pairwiseErrorStats(source, reconstructed);
  return {
    sampleCount: source.length,
    step,
    quantized,
    reconstructed,
    zeroCount,
    zeroRatio: source.length > 0 ? zeroCount / source.length : 0,
    mse: errors.mse,
    rmse: errors.rmse,
    mae: errors.mae,
    peakAbsoluteError: errors.peakAbsoluteError,
    psnr: peakSignalToNoiseRatio(source, reconstructed, { dataRange }),
  };
}

export function lossyResidualReport(reference, candidate, options = {}) {
  const expected = numericArray(reference, 'reference');
  const actual = numericArray(candidate, 'candidate');
  if (expected.length !== actual.length) {
    throw new RangeError('reference and candidate must have matching lengths');
  }
  const dataRange = positiveFinite(options.dataRange ?? DEFAULT_DATA_RANGE, 'dataRange');
  const residuals = new Float64Array(expected.length);
  for (let index = 0; index < expected.length; index++) {
    residuals[index] = actual[index] - expected[index];
  }
  const errors = pairwiseErrorStats(expected, actual);
  return {
    sampleCount: expected.length,
    residuals,
    mse: errors.mse,
    rmse: errors.rmse,
    mae: errors.mae,
    peakAbsoluteError: errors.peakAbsoluteError,
    psnr: peakSignalToNoiseRatio(expected, actual, { dataRange }),
    residualEnergy: sumSquares(residuals),
  };
}

export function lossyBlockDctReport(values, options = {}) {
  const { width, height, count } = blockShape(options);
  const source = numericArray(values);
  if (source.length !== count) {
    throw new RangeError('values length must equal width * height');
  }
  const levelShift = finiteNumber(options.levelShift ?? 0, 'levelShift');
  const dataRange = positiveFinite(options.dataRange ?? DEFAULT_DATA_RANGE, 'dataRange');
  const clampMin = options.clampMin === undefined ? null : finiteNumber(options.clampMin, 'clampMin');
  const clampMax = options.clampMax === undefined ? null : finiteNumber(options.clampMax, 'clampMax');
  const shifted = new Float64Array(count);
  for (let index = 0; index < count; index++) shifted[index] = source[index] - levelShift;

  const coefficients = lossyDct2D(shifted, { width, height });
  const quantization = lossyQuantizeCoefficients(coefficients, options.quantization ?? 1);
  const reconstructedShifted = lossyIdct2D(quantization.dequantized, { width, height });
  const reconstructed = new Float64Array(count);
  for (let index = 0; index < count; index++) {
    reconstructed[index] = maybeClamp(reconstructedShifted[index] + levelShift, clampMin, clampMax);
  }

  const mse = meanSquaredError(source, reconstructed);
  const coefficientEnergy = sumSquares(coefficients);
  const retainedEnergy = sumSquares(quantization.dequantized);
  const zigZag = lossyZigZagIndices(width, height);

  return {
    width,
    height,
    sampleCount: count,
    levelShift,
    coefficients,
    quantized: quantization.quantized,
    dequantized: quantization.dequantized,
    reconstructed,
    zigZag,
    zeroCoefficientCount: quantization.zeroCount,
    nonzeroCoefficientCount: quantization.nonzeroCount,
    zeroCoefficientRatio: quantization.zeroRatio,
    coefficientEnergy,
    retainedEnergy,
    retainedEnergyRatio: coefficientEnergy > 0 ? retainedEnergy / coefficientEnergy : 1,
    dcCoefficient: coefficients[0] ?? 0,
    mse,
    psnr: peakSignalToNoiseRatio(source, reconstructed, { dataRange }),
  };
}

export default {
  lossyDct1D,
  lossyIdct1D,
  lossyDct2D,
  lossyIdct2D,
  lossyZigZagIndices,
  lossyQuantizeCoefficients,
  lossyScalarQuantizationReport,
  lossyResidualReport,
  lossyBlockDctReport,
};
