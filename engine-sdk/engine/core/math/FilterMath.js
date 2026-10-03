// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

// FilterMath.js - reusable filter kernel, signal FIR, and CPU RGBA convolution helpers.

import { clamp } from './MathScalar.js';
import { imageDataReport } from './ImageMath.js';
import {
  convolve,
  convolveSame,
  exponentialMovingAverage,
  firFilter,
  medianFilter,
} from './MathSignal.js';

export const FILTER_IMAGE_EDGE_MODES = Object.freeze(['clamp', 'zero']);

const FILTER_KERNEL_PRESETS = Object.freeze({
  identity3: Object.freeze({
    width: 3,
    height: 3,
    kernel: Object.freeze([0, 0, 0, 0, 1, 0, 0, 0, 0]),
  }),
  box3: Object.freeze({
    width: 3,
    height: 3,
    kernel: Object.freeze([
      1 / 9, 1 / 9, 1 / 9,
      1 / 9, 1 / 9, 1 / 9,
      1 / 9, 1 / 9, 1 / 9,
    ]),
  }),
  sharpen: Object.freeze({
    width: 3,
    height: 3,
    kernel: Object.freeze([0, -1, 0, -1, 5, -1, 0, -1, 0]),
  }),
  sobelX: Object.freeze({
    width: 3,
    height: 3,
    kernel: Object.freeze([-1, 0, 1, -2, 0, 2, -1, 0, 1]),
  }),
  sobelY: Object.freeze({
    width: 3,
    height: 3,
    kernel: Object.freeze([-1, -2, -1, 0, 0, 0, 1, 2, 1]),
  }),
  laplacian4: Object.freeze({
    width: 3,
    height: 3,
    kernel: Object.freeze([0, -1, 0, -1, 4, -1, 0, -1, 0]),
  }),
  edgeDetect: Object.freeze({
    width: 3,
    height: 3,
    kernel: Object.freeze([-1, -1, -1, -1, 8, -1, -1, -1, -1]),
  }),
});

const FILTER_KERNEL_ALIASES = Object.freeze({
  identity: 'identity3',
  box: 'box3',
  blur: 'box3',
  laplacian: 'laplacian4',
  sobelx: 'sobelX',
  sobely: 'sobelY',
  edge: 'edgeDetect',
  edgedetect: 'edgeDetect',
});

export function filterKernelReport(kernel, options = {}) {
  const values = checkedKernel(kernel, 'kernel');
  const tolerance = nonnegativeFinite(options.tolerance ?? 1e-9, 'tolerance');
  const targetSum = finiteNumber(options.targetSum ?? 1, 'targetSum');
  let sum = 0;
  let absSum = 0;
  let min = Infinity;
  let max = -Infinity;
  let finite = true;
  let symmetric = true;

  for (let i = 0; i < values.length; i++) {
    const value = Number(values[i]);
    if (!Number.isFinite(value)) finite = false;
    sum += value;
    absSum += Math.abs(value);
    min = Math.min(min, value);
    max = Math.max(max, value);
  }

  for (let i = 0; i < Math.floor(values.length / 2); i++) {
    if (Math.abs(values[i] - values[values.length - 1 - i]) > tolerance) {
      symmetric = false;
      break;
    }
  }

  const width = options.width === undefined ? null : positiveInteger(options.width, 'width');
  const height = options.height === undefined ? null : positiveInteger(options.height, 'height');
  const shaped = width !== null && height !== null;
  const errors = [];
  if (!finite) errors.push('kernel-non-finite');
  if (shaped && width * height !== values.length) errors.push('kernel-shape-mismatch');

  return {
    valid: errors.length === 0,
    errors: Object.freeze(errors),
    count: values.length,
    width,
    height,
    sum,
    absSum,
    min,
    max,
    normalized: Math.abs(sum - targetSum) <= tolerance,
    zeroSum: Math.abs(sum) <= tolerance,
    symmetric,
  };
}

export function normalizeFilterKernel(kernel, targetSum = 1, options = {}) {
  const values = checkedKernel(kernel, 'kernel');
  const target = finiteNumber(targetSum, 'targetSum');
  const tolerance = nonnegativeFinite(options.tolerance ?? 1e-12, 'tolerance');
  const sum = values.reduce((total, value) => total + value, 0);
  if (Math.abs(sum) <= tolerance) {
    if (options.allowZeroSum) return values.slice();
    throw new RangeError('kernel sum must be nonzero to normalize');
  }
  const scale = target / sum;
  return values.map((value) => value * scale);
}

export function boxFilterKernel1D(radius = 1, options = {}) {
  const size = options.size === true
    ? positiveOddInteger(radius, 'size')
    : positiveOddInteger(2 * nonnegativeInteger(radius, 'radius') + 1, 'size');
  return new Array(size).fill(1 / size);
}

export function gaussianFilterKernel1D(radius = 1, sigma = null) {
  const r = nonnegativeInteger(radius, 'radius');
  const spread = sigma === null ? Math.max(1e-12, r / 2 || 1) : positiveFinite(sigma, 'sigma');
  const variance = 2 * spread * spread;
  const values = [];
  for (let x = -r; x <= r; x++) values.push(Math.exp(-(x * x) / variance));
  return normalizeFilterKernel(values, 1);
}

export function gaussianFilterKernel2D(radius = 1, sigma = null) {
  const oneD = gaussianFilterKernel1D(radius, sigma);
  const size = oneD.length;
  const kernel = [];
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) kernel.push(oneD[x] * oneD[y]);
  }
  return {
    name: 'gaussian',
    width: size,
    height: size,
    kernel: Object.freeze(normalizeFilterKernel(kernel, 1)),
  };
}

export function filterKernelPreset(name) {
  const key = String(name ?? '').trim();
  const canonical = FILTER_KERNEL_PRESETS[key]
    ? key
    : FILTER_KERNEL_ALIASES[key.toLowerCase()];
  const preset = FILTER_KERNEL_PRESETS[canonical];
  if (!preset) throw new RangeError(`unknown filter kernel preset: ${name}`);
  return {
    name: canonical,
    width: preset.width,
    height: preset.height,
    kernel: Object.freeze([...preset.kernel]),
    report: filterKernelReport(preset.kernel, {
      width: preset.width,
      height: preset.height,
      targetSum: canonical === 'edgeDetect' || canonical.startsWith('sobel') || canonical.startsWith('laplacian') ? 0 : 1,
    }),
  };
}

export function filterSignalFIR(signal, kernel, options = {}) {
  const samples = checkedSignal(signal, 'signal');
  if (samples.length === 0) return [];
  const taps = options.normalizeKernel
    ? normalizeFilterKernel(kernel, options.targetSum ?? 1)
    : checkedKernel(kernel, 'kernel');
  const mode = String(options.mode ?? 'same').toLowerCase();
  if (mode === 'full') return convolve(samples, taps);
  if (mode === 'causal') return firFilter(samples, taps);
  if (mode !== 'same' && mode !== 'centered') {
    throw new RangeError(`unsupported FIR filter mode: ${options.mode}`);
  }
  return convolveSame(samples, taps);
}

export function filterSignalMedian(signal, windowSize = 3) {
  const samples = checkedSignal(signal, 'signal');
  if (samples.length === 0) return [];
  return medianFilter(samples, positiveOddInteger(windowSize, 'windowSize'));
}

export function filterSignalTemporalSmooth(signal, alpha = 0.5) {
  const samples = checkedSignal(signal, 'signal');
  if (samples.length === 0) return [];
  const amount = clamp(finiteNumber(alpha, 'alpha'), 0, 1);
  return exponentialMovingAverage(samples, amount);
}

export function filterSignalNoiseReduce(signal, options = {}) {
  const samples = checkedSignal(signal, 'signal');
  if (samples.length === 0) return [];

  const medianWindowSize = positiveOddInteger(options.medianWindowSize ?? options.windowSize ?? 3, 'medianWindowSize');
  const smoothingRadius = nonnegativeInteger(options.smoothingRadius ?? options.radius ?? 0, 'smoothingRadius');
  const blend = clamp(finiteNumber(options.blend ?? 1, 'blend'), 0, 1);
  let filtered = medianWindowSize === 1 ? samples.slice() : filterSignalMedian(samples, medianWindowSize);
  if (smoothingRadius > 0) {
    filtered = filterSignalFIR(filtered, boxFilterKernel1D(smoothingRadius), { mode: 'same' });
  }
  if (blend < 1) {
    filtered = filtered.map((value, index) => samples[index] * (1 - blend) + value * blend);
  }
  return filtered;
}

export function filterImageConvolutionRgba(image, kernelSpec, options = {}) {
  const imageReport = imageDataReport(image, options);
  if (!imageReport.valid) {
    throw new RangeError(`invalid image data: ${imageReport.errors.join(', ')}`);
  }
  const shape = kernelShape(kernelSpec, options);
  const edgeMode = filterImageEdgeMode(options.edgeMode ?? 'clamp');
  const includeAlpha = options.includeAlpha === true;
  const output = new Uint8ClampedArray(imageReport.width * imageReport.height * 4);
  const halfWidth = Math.floor(shape.width / 2);
  const halfHeight = Math.floor(shape.height / 2);

  for (let y = 0; y < imageReport.height; y++) {
    for (let x = 0; x < imageReport.width; x++) {
      const outOffset = (y * imageReport.width + x) * 4;
      const sums = [0, 0, 0, 0];

      for (let ky = 0; ky < shape.height; ky++) {
        for (let kx = 0; kx < shape.width; kx++) {
          const sx = x + kx - halfWidth;
          const sy = y + ky - halfHeight;
          const weight = shape.kernel[ky * shape.width + kx];
          const sample = readConvolutionPixel(imageReport, sx, sy, edgeMode);
          for (let channel = 0; channel < (includeAlpha ? 4 : 3); channel++) {
            sums[channel] += sample[channel] * weight;
          }
        }
      }

      output[outOffset] = byte(sums[0]);
      output[outOffset + 1] = byte(sums[1]);
      output[outOffset + 2] = byte(sums[2]);
      output[outOffset + 3] = includeAlpha
        ? byte(sums[3])
        : byte(imageReport.data[outOffset + 3], 255);
    }
  }

  return {
    data: output,
    width: imageReport.width,
    height: imageReport.height,
    kernelWidth: shape.width,
    kernelHeight: shape.height,
    edgeMode,
    includeAlpha,
    kernelSum: shape.report.sum,
  };
}

export function filterImageMorphologyRgba(image, operator = 'dilate', radius = 1, options = {}) {
  const imageReport = imageDataReport(image, options);
  if (!imageReport.valid) {
    throw new RangeError(`invalid image data: ${imageReport.errors.join(', ')}`);
  }
  const op = normalizeMorphologyOperator(operator);
  const { radiusX, radiusY } = morphologyRadius(radius);
  const edgeMode = filterImageEdgeMode(options.edgeMode ?? 'clamp');
  const channels = morphologyChannels(options.channels ?? options.channelMode ?? 'rgba');
  const output = new Uint8ClampedArray(imageReport.width * imageReport.height * 4);

  if (radiusX === 0 && radiusY === 0) {
    output.set(imageReport.data.slice ? imageReport.data.slice(0, output.length) : Array.from(imageReport.data).slice(0, output.length));
    return {
      data: output,
      width: imageReport.width,
      height: imageReport.height,
      operator: op,
      radiusX,
      radiusY,
      edgeMode,
      channels,
      changed: false,
    };
  }

  for (let y = 0; y < imageReport.height; y++) {
    for (let x = 0; x < imageReport.width; x++) {
      const outOffset = (y * imageReport.width + x) * 4;
      for (let channel = 0; channel < 4; channel++) {
        if (!morphologyIncludesChannel(channels, channel)) {
          output[outOffset + channel] = byte(imageReport.data[outOffset + channel], channel === 3 ? 255 : 0);
          continue;
        }

        let value = op === 'dilate' ? 0 : 255;
        for (let dy = -radiusY; dy <= radiusY; dy++) {
          for (let dx = -radiusX; dx <= radiusX; dx++) {
            const sample = readConvolutionPixel(imageReport, x + dx, y + dy, edgeMode)[channel];
            value = op === 'dilate' ? Math.max(value, sample) : Math.min(value, sample);
          }
        }
        output[outOffset + channel] = value;
      }
    }
  }

  return {
    data: output,
    width: imageReport.width,
    height: imageReport.height,
    operator: op,
    radiusX,
    radiusY,
    edgeMode,
    channels,
    changed: true,
  };
}

export function filterImageDilateRgba(image, radius = 1, options = {}) {
  return filterImageMorphologyRgba(image, 'dilate', radius, options);
}

export function filterImageErodeRgba(image, radius = 1, options = {}) {
  return filterImageMorphologyRgba(image, 'erode', radius, options);
}

function kernelShape(kernelSpec, options = {}) {
  const preset = typeof kernelSpec === 'string' ? filterKernelPreset(kernelSpec) : kernelSpec;
  const source = preset && typeof preset === 'object' && 'kernel' in preset ? preset.kernel : preset;
  const width = positiveInteger(
    preset?.width ?? options.kernelWidth ?? options.width ?? inferredKernelWidth(source),
    'kernelWidth',
  );
  const height = positiveInteger(
    preset?.height ?? options.kernelHeight ?? options.height ?? Math.ceil(source.length / width),
    'kernelHeight',
  );
  const kernel = checkedKernel(source, 'kernel');
  const report = filterKernelReport(kernel, { width, height, targetSum: options.targetSum ?? 1 });
  if (!report.valid) {
    throw new RangeError(`invalid filter kernel: ${report.errors.join(', ')}`);
  }
  return { kernel, width, height, report };
}

function inferredKernelWidth(kernel) {
  const count = checkedKernel(kernel, 'kernel').length;
  const square = Math.sqrt(count);
  return Number.isInteger(square) ? square : count;
}

function readConvolutionPixel(report, x, y, edgeMode) {
  let sx = x;
  let sy = y;
  if (sx < 0 || sy < 0 || sx >= report.width || sy >= report.height) {
    if (edgeMode === 'zero') return [0, 0, 0, 0];
    sx = clamp(sx, 0, report.width - 1);
    sy = clamp(sy, 0, report.height - 1);
  }
  const offset = (sy * report.width + sx) * 4;
  return [
    byte(report.data[offset]),
    byte(report.data[offset + 1]),
    byte(report.data[offset + 2]),
    byte(report.data[offset + 3], 255),
  ];
}

function filterImageEdgeMode(value) {
  const mode = String(value ?? 'clamp').toLowerCase();
  if (FILTER_IMAGE_EDGE_MODES.includes(mode)) return mode;
  throw new RangeError(`unsupported filter image edge mode: ${value}`);
}

function normalizeMorphologyOperator(value) {
  const op = String(value ?? 'dilate').toLowerCase();
  if (op === 'dilate' || op === 'max') return 'dilate';
  if (op === 'erode' || op === 'min') return 'erode';
  throw new RangeError(`unsupported morphology operator: ${value}`);
}

function morphologyRadius(radius) {
  if (Array.isArray(radius)) {
    return {
      radiusX: nonnegativeInteger(radius[0] ?? 0, 'radiusX'),
      radiusY: nonnegativeInteger(radius[1] ?? radius[0] ?? 0, 'radiusY'),
    };
  }
  if (radius && typeof radius === 'object') {
    return {
      radiusX: nonnegativeInteger(radius.x ?? radius.radiusX ?? 0, 'radiusX'),
      radiusY: nonnegativeInteger(radius.y ?? radius.radiusY ?? radius.x ?? radius.radiusX ?? 0, 'radiusY'),
    };
  }
  const value = nonnegativeInteger(radius, 'radius');
  return { radiusX: value, radiusY: value };
}

function morphologyChannels(value) {
  const channels = String(value ?? 'rgba').toLowerCase();
  if (channels === 'rgba' || channels === 'rgb' || channels === 'alpha' || channels === 'a') {
    return channels === 'a' ? 'alpha' : channels;
  }
  throw new RangeError(`unsupported morphology channels: ${value}`);
}

function morphologyIncludesChannel(channels, channel) {
  if (channels === 'rgba') return true;
  if (channels === 'rgb') return channel < 3;
  return channel === 3;
}

function checkedKernel(values, name) {
  if (!values || typeof values.length !== 'number') {
    throw new RangeError(`${name} must be array-like`);
  }
  if (values.length <= 0) throw new RangeError(`${name} must not be empty`);
  const result = Array.from(values, (value, index) => finiteNumber(value, `${name}[${index}]`));
  return result;
}

function checkedSignal(values, name) {
  if (!values || typeof values.length !== 'number') {
    throw new RangeError(`${name} must be array-like`);
  }
  return Array.from(values, (value, index) => finiteNumber(value, `${name}[${index}]`));
}

function finiteNumber(value, name) {
  const number = Number(value);
  if (!Number.isFinite(number)) throw new RangeError(`${name} must be finite`);
  return number;
}

function positiveFinite(value, name) {
  const number = finiteNumber(value, name);
  if (number <= 0) throw new RangeError(`${name} must be positive`);
  return number;
}

function nonnegativeFinite(value, name) {
  const number = finiteNumber(value, name);
  if (number < 0) throw new RangeError(`${name} must be nonnegative`);
  return number;
}

function integer(value, name) {
  const number = finiteNumber(value, name);
  if (!Number.isSafeInteger(number)) throw new RangeError(`${name} must be a safe integer`);
  return number;
}

function nonnegativeInteger(value, name) {
  const number = integer(value, name);
  if (number < 0) throw new RangeError(`${name} must be nonnegative`);
  return number;
}

function positiveInteger(value, name) {
  const number = integer(value, name);
  if (number <= 0) throw new RangeError(`${name} must be positive`);
  return number;
}

function positiveOddInteger(value, name) {
  const number = positiveInteger(value, name);
  if (number % 2 !== 1) throw new RangeError(`${name} must be odd`);
  return number;
}

function byte(value, fallback = 0) {
  const number = Number(value);
  return clamp(Math.round(Number.isFinite(number) ? number : fallback), 0, 255);
}
