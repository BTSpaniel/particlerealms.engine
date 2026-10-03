// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * ImageMath.js - deterministic RGBA/ImageData pixel helpers.
 *
 * These helpers intentionally operate on ImageData-like objects or raw RGBA
 * array data. They do not construct browser ImageData, canvas, bitmap, or GPU
 * resources, so they remain safe for workers and deterministic tests.
 */

import { clamp, lerp, saturate } from './MathScalar.js';
import { premultiplyAlpha, unpremultiplyAlpha } from './BlendMath.js';
import { COLOR_LUMA_REC709, linearRgbLuminance, relativeLuminance } from './MathColor.js';

export const IMAGE_CHANNEL_COUNT_RGBA = 4;
export const IMAGE_LUMA_REC709_BYTE_WEIGHTS = Object.freeze([...COLOR_LUMA_REC709]);
export const IMAGE_EDGE_MODES = Object.freeze(['none', 'clamp', 'wrap', 'mirror']);
export const IMAGE_CHANNEL_INDEX = Object.freeze({
  r: 0,
  red: 0,
  g: 1,
  green: 1,
  b: 2,
  blue: 2,
  a: 3,
  alpha: 3,
});

function finiteOrDefault(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function integerOrDefault(value, fallback = 0) {
  return Math.floor(finiteOrDefault(value, fallback));
}

function positiveIntegerOrDefault(value, fallback = 1) {
  return Math.max(1, integerOrDefault(value, fallback));
}

function nonNegativeInteger(value, fallback = 0) {
  return Math.max(0, integerOrDefault(value, fallback));
}

function byteChannel(value, fallback = 0) {
  return clamp(Math.round(finiteOrDefault(value, fallback)), 0, 255);
}

function normalizedByteChannel(value, fallback = 0) {
  return saturate(finiteOrDefault(value, fallback)) * 255;
}

function imageDataSource(image, options = {}) {
  const source = image && typeof image === 'object' && 'data' in image ? image : options;
  const data = image && typeof image === 'object' && 'data' in image ? image.data : image;
  const width = source?.width ?? options.width;
  const height = source?.height ?? options.height;
  return { data, width, height };
}

function hasArrayLength(value) {
  return value && typeof value.length === 'number';
}

function normalizeEdgeMode(edgeMode = 'none') {
  const mode = String(edgeMode || 'none').toLowerCase();
  return IMAGE_EDGE_MODES.includes(mode) ? mode : 'clamp';
}

function wrapIndex(value, size) {
  const index = integerOrDefault(value);
  return ((index % size) + size) % size;
}

function mirrorIndex(value, size) {
  if (size <= 1) return 0;
  const period = size * 2 - 2;
  const wrapped = wrapIndex(value, period);
  return wrapped < size ? wrapped : period - wrapped;
}

function pixelCoordinate(value, size, edgeMode = 'none', axisName = 'coordinate') {
  const index = integerOrDefault(value);
  switch (normalizeEdgeMode(edgeMode)) {
    case 'clamp':
      return clamp(index, 0, size - 1);
    case 'wrap':
      return wrapIndex(index, size);
    case 'mirror':
      return mirrorIndex(index, size);
    case 'none':
    default:
      if (index < 0 || index >= size) {
        throw new RangeError(`ImageMath ${axisName} out of bounds: ${index} not in [0, ${size - 1}]`);
      }
      return index;
  }
}

function outputArray(length, sourceData, options = {}) {
  const ArrayType = options.ArrayType || options.arrayType || sourceData?.constructor || Uint8ClampedArray;
  try {
    return new ArrayType(length);
  } catch (_error) {
    return new Uint8ClampedArray(length);
  }
}

function checkedImage(image, options = {}) {
  const report = imageDataReport(image, options);
  if (!report.valid) {
    throw new RangeError(`Invalid RGBA image data: ${report.errors.join(', ')}`);
  }
  return report;
}

function sampleAxis(value, size, normalizedCoordinates = false) {
  const coordinate = finiteOrDefault(value);
  return normalizedCoordinates ? coordinate * (size - 1) : coordinate;
}

function channelFromOrderToken(token, fallback) {
  if (typeof token === 'number') return clamp(Math.floor(token), 0, 3);
  if (typeof token === 'string' && token.toLowerCase() in IMAGE_CHANNEL_INDEX) {
    return IMAGE_CHANNEL_INDEX[token.toLowerCase()];
  }
  return fallback;
}

function writePixelToData(data, offset, rgba, normalized = false) {
  data[offset] = byteChannel(normalized ? normalizedByteChannel(rgba?.[0]) : rgba?.[0]);
  data[offset + 1] = byteChannel(normalized ? normalizedByteChannel(rgba?.[1]) : rgba?.[1]);
  data[offset + 2] = byteChannel(normalized ? normalizedByteChannel(rgba?.[2]) : rgba?.[2]);
  data[offset + 3] = byteChannel(normalized ? normalizedByteChannel(rgba?.[3], 1) : rgba?.[3], 255);
}

function encodedLuminanceFromBytes(r, g, b, coefficients = IMAGE_LUMA_REC709_BYTE_WEIGHTS) {
  return r * coefficients[0] + g * coefficients[1] + b * coefficients[2];
}

function imageLuminanceAt(data, offset, options = {}) {
  const coefficients = options.coefficients || IMAGE_LUMA_REC709_BYTE_WEIGHTS;
  const r = byteChannel(data[offset]);
  const g = byteChannel(data[offset + 1]);
  const b = byteChannel(data[offset + 2]);
  const a = byteChannel(data[offset + 3], 255);
  const mode = String(options.mode || 'encoded').toLowerCase();
  const alphaWeight = finiteOrDefault(options.includeAlphaWeight ?? options.alphaWeight, 0);
  let luminance;
  if (mode === 'relative') {
    luminance = relativeLuminance([r / 255, g / 255, b / 255]) * 255;
  } else if (mode === 'linear') {
    luminance = linearRgbLuminance([r / 255, g / 255, b / 255], coefficients) * 255;
  } else {
    luminance = encodedLuminanceFromBytes(r, g, b, coefficients);
  }
  return luminance + a * alphaWeight;
}

export function imageDataReport(image, options = {}) {
  const source = imageDataSource(image, options);
  const data = source.data;
  const width = integerOrDefault(source.width);
  const height = integerOrDefault(source.height);
  const expectedByteLength = width > 0 && height > 0 ? width * height * IMAGE_CHANNEL_COUNT_RGBA : 0;
  const byteLength = hasArrayLength(data) ? Number(data.length) : 0;
  const errors = [];
  const warnings = [];

  if (!hasArrayLength(data)) errors.push('data-missing');
  if (!Number.isInteger(width) || width <= 0) errors.push('width-invalid');
  if (!Number.isInteger(height) || height <= 0) errors.push('height-invalid');
  if (expectedByteLength > 0 && byteLength < expectedByteLength) errors.push('data-too-short');
  if (expectedByteLength > 0 && byteLength > expectedByteLength) warnings.push('data-extra-bytes');

  return {
    valid: errors.length === 0,
    errors: Object.freeze(errors),
    warnings: Object.freeze(warnings),
    data,
    width,
    height,
    channelCount: IMAGE_CHANNEL_COUNT_RGBA,
    pixelCount: expectedByteLength / IMAGE_CHANNEL_COUNT_RGBA,
    byteLength,
    expectedByteLength,
    extraByteLength: Math.max(0, byteLength - expectedByteLength),
  };
}

export function imagePixelOffset(width, x, y, options = {}) {
  const w = positiveIntegerOrDefault(width);
  const h = options.height == null ? null : positiveIntegerOrDefault(options.height);
  const edgeMode = options.edgeMode ?? 'none';
  const ix = pixelCoordinate(x, w, edgeMode, 'x');
  const iy = h == null
    ? nonNegativeInteger(y)
    : pixelCoordinate(y, h, edgeMode, 'y');
  return (iy * w + ix) * IMAGE_CHANNEL_COUNT_RGBA;
}

export function imageReadPixel(image, x, y, options = {}) {
  const report = checkedImage(image, options);
  const offset = imagePixelOffset(report.width, x, y, {
    height: report.height,
    edgeMode: options.edgeMode ?? 'clamp',
  });
  const rgba = [
    byteChannel(report.data[offset]),
    byteChannel(report.data[offset + 1]),
    byteChannel(report.data[offset + 2]),
    byteChannel(report.data[offset + 3], 255),
  ];
  return options.normalized || options.normalizedOutput
    ? rgba.map((channel) => channel / 255)
    : rgba;
}

export function imageWritePixel(image, x, y, rgba, options = {}) {
  const report = checkedImage(image, options);
  const offset = imagePixelOffset(report.width, x, y, {
    height: report.height,
    edgeMode: options.edgeMode ?? 'none',
  });
  writePixelToData(report.data, offset, rgba, options.normalized || options.normalizedInput);
  return {
    offset,
    x: pixelCoordinate(x, report.width, options.edgeMode ?? 'none', 'x'),
    y: pixelCoordinate(y, report.height, options.edgeMode ?? 'none', 'y'),
    pixel: Object.freeze([
      byteChannel(report.data[offset]),
      byteChannel(report.data[offset + 1]),
      byteChannel(report.data[offset + 2]),
      byteChannel(report.data[offset + 3], 255),
    ]),
  };
}

export function imageSampleNearest(image, x, y, options = {}) {
  const report = checkedImage(image, options);
  const normalizedCoordinates = Boolean(options.normalizedCoordinates ?? options.normalizedCoords);
  const sx = Math.round(sampleAxis(x, report.width, normalizedCoordinates));
  const sy = Math.round(sampleAxis(y, report.height, normalizedCoordinates));
  return imageReadPixel(report, sx, sy, {
    edgeMode: options.edgeMode ?? 'clamp',
    normalizedOutput: options.normalizedOutput,
  });
}

export function imageSampleBilinear(image, x, y, options = {}) {
  const report = checkedImage(image, options);
  const normalizedCoordinates = Boolean(options.normalizedCoordinates ?? options.normalizedCoords);
  const sx = sampleAxis(x, report.width, normalizedCoordinates);
  const sy = sampleAxis(y, report.height, normalizedCoordinates);
  const x0 = Math.floor(sx);
  const y0 = Math.floor(sy);
  const x1 = x0 + 1;
  const y1 = y0 + 1;
  const tx = saturate(sx - x0);
  const ty = saturate(sy - y0);
  const p00 = imageReadPixel(report, x0, y0, { edgeMode: options.edgeMode ?? 'clamp' });
  const p10 = imageReadPixel(report, x1, y0, { edgeMode: options.edgeMode ?? 'clamp' });
  const p01 = imageReadPixel(report, x0, y1, { edgeMode: options.edgeMode ?? 'clamp' });
  const p11 = imageReadPixel(report, x1, y1, { edgeMode: options.edgeMode ?? 'clamp' });
  const sample = [0, 1, 2, 3].map((channel) => {
    const top = lerp(p00[channel], p10[channel], tx);
    const bottom = lerp(p01[channel], p11[channel], tx);
    return lerp(top, bottom, ty);
  });
  if (options.round || options.byteOutput) return sample.map((channel) => byteChannel(channel));
  return options.normalizedOutput ? sample.map((channel) => channel / 255) : sample;
}

export function imageCopyRect(image, rect = {}, options = {}) {
  const report = checkedImage(image, options);
  const x = integerOrDefault(rect.x ?? rect.left, 0);
  const y = integerOrDefault(rect.y ?? rect.top, 0);
  const width = positiveIntegerOrDefault(rect.width ?? rect.w, report.width);
  const height = positiveIntegerOrDefault(rect.height ?? rect.h, report.height);
  const out = outputArray(width * height * IMAGE_CHANNEL_COUNT_RGBA, report.data, options);
  const edgeMode = options.edgeMode ?? 'clamp';

  for (let row = 0; row < height; row += 1) {
    for (let col = 0; col < width; col += 1) {
      const pixel = imageReadPixel(report, x + col, y + row, { edgeMode });
      const offset = (row * width + col) * IMAGE_CHANNEL_COUNT_RGBA;
      writePixelToData(out, offset, pixel);
    }
  }

  return {
    data: out,
    width,
    height,
    channelCount: IMAGE_CHANNEL_COUNT_RGBA,
    sourceRect: Object.freeze({ x, y, width, height, edgeMode: normalizeEdgeMode(edgeMode) }),
  };
}

export function imageFlipX(image, options = {}) {
  const report = checkedImage(image, options);
  const out = outputArray(report.expectedByteLength, report.data, options);
  for (let y = 0; y < report.height; y += 1) {
    for (let x = 0; x < report.width; x += 1) {
      const src = imagePixelOffset(report.width, report.width - 1 - x, y, { height: report.height });
      const dst = imagePixelOffset(report.width, x, y, { height: report.height });
      out[dst] = report.data[src];
      out[dst + 1] = report.data[src + 1];
      out[dst + 2] = report.data[src + 2];
      out[dst + 3] = report.data[src + 3];
    }
  }
  return { data: out, width: report.width, height: report.height, channelCount: IMAGE_CHANNEL_COUNT_RGBA };
}

export function imageFlipY(image, options = {}) {
  const report = checkedImage(image, options);
  const out = outputArray(report.expectedByteLength, report.data, options);
  for (let y = 0; y < report.height; y += 1) {
    for (let x = 0; x < report.width; x += 1) {
      const src = imagePixelOffset(report.width, x, report.height - 1 - y, { height: report.height });
      const dst = imagePixelOffset(report.width, x, y, { height: report.height });
      out[dst] = report.data[src];
      out[dst + 1] = report.data[src + 1];
      out[dst + 2] = report.data[src + 2];
      out[dst + 3] = report.data[src + 3];
    }
  }
  return { data: out, width: report.width, height: report.height, channelCount: IMAGE_CHANNEL_COUNT_RGBA };
}

export function imageSwizzleRgba(image, order = [0, 1, 2, 3], options = {}) {
  const report = checkedImage(image, options);
  const channels = [0, 1, 2, 3].map((fallback) => channelFromOrderToken(order?.[fallback], fallback));
  const out = outputArray(report.expectedByteLength, report.data, options);
  for (let offset = 0; offset < report.expectedByteLength; offset += IMAGE_CHANNEL_COUNT_RGBA) {
    const pixel = [
      byteChannel(report.data[offset]),
      byteChannel(report.data[offset + 1]),
      byteChannel(report.data[offset + 2]),
      byteChannel(report.data[offset + 3], 255),
    ];
    out[offset] = pixel[channels[0]];
    out[offset + 1] = pixel[channels[1]];
    out[offset + 2] = pixel[channels[2]];
    out[offset + 3] = pixel[channels[3]];
  }
  return { data: out, width: report.width, height: report.height, channelCount: IMAGE_CHANNEL_COUNT_RGBA };
}

export function imagePremultiplyAlpha(image, options = {}) {
  const report = checkedImage(image, options);
  const out = outputArray(report.expectedByteLength, report.data, options);
  for (let offset = 0; offset < report.expectedByteLength; offset += IMAGE_CHANNEL_COUNT_RGBA) {
    const premultiplied = premultiplyAlpha([
      byteChannel(report.data[offset]) / 255,
      byteChannel(report.data[offset + 1]) / 255,
      byteChannel(report.data[offset + 2]) / 255,
      byteChannel(report.data[offset + 3], 255) / 255,
    ]);
    writePixelToData(out, offset, premultiplied, true);
  }
  return { data: out, width: report.width, height: report.height, channelCount: IMAGE_CHANNEL_COUNT_RGBA };
}

export function imageUnpremultiplyAlpha(image, options = {}) {
  const report = checkedImage(image, options);
  const out = outputArray(report.expectedByteLength, report.data, options);
  for (let offset = 0; offset < report.expectedByteLength; offset += IMAGE_CHANNEL_COUNT_RGBA) {
    const straight = unpremultiplyAlpha([
      byteChannel(report.data[offset]) / 255,
      byteChannel(report.data[offset + 1]) / 255,
      byteChannel(report.data[offset + 2]) / 255,
      byteChannel(report.data[offset + 3], 255) / 255,
    ]);
    writePixelToData(out, offset, straight, true);
  }
  return { data: out, width: report.width, height: report.height, channelCount: IMAGE_CHANNEL_COUNT_RGBA };
}

export function imageHistogramReport(image, options = {}) {
  const report = checkedImage(image, options);
  const includeAlpha = options.includeAlpha !== false;
  const includeLuminance = options.includeLuminance !== false;
  const r = new Uint32Array(256);
  const g = new Uint32Array(256);
  const b = new Uint32Array(256);
  const a = includeAlpha ? new Uint32Array(256) : null;
  const luminance = includeLuminance ? new Uint32Array(256) : null;

  for (let offset = 0; offset < report.expectedByteLength; offset += IMAGE_CHANNEL_COUNT_RGBA) {
    const red = byteChannel(report.data[offset]);
    const green = byteChannel(report.data[offset + 1]);
    const blue = byteChannel(report.data[offset + 2]);
    const alpha = byteChannel(report.data[offset + 3], 255);
    r[red] += 1;
    g[green] += 1;
    b[blue] += 1;
    if (a) a[alpha] += 1;
    if (luminance) luminance[byteChannel(encodedLuminanceFromBytes(red, green, blue, options.coefficients))] += 1;
  }

  return {
    width: report.width,
    height: report.height,
    pixelCount: report.pixelCount,
    r,
    g,
    b,
    a,
    luminance,
  };
}

export function imageAverageColor(image, options = {}) {
  const report = checkedImage(image, options);
  let r = 0;
  let g = 0;
  let b = 0;
  let a = 0;
  for (let offset = 0; offset < report.expectedByteLength; offset += IMAGE_CHANNEL_COUNT_RGBA) {
    r += byteChannel(report.data[offset]);
    g += byteChannel(report.data[offset + 1]);
    b += byteChannel(report.data[offset + 2]);
    a += byteChannel(report.data[offset + 3], 255);
  }
  const divisor = Math.max(1, report.pixelCount);
  const scale = options.normalized || options.normalizedOutput ? 1 / 255 : 1;
  const rgba = [r / divisor, g / divisor, b / divisor, a / divisor].map((channel) => channel * scale);
  return {
    width: report.width,
    height: report.height,
    pixelCount: report.pixelCount,
    normalized: Boolean(options.normalized || options.normalizedOutput),
    rgba: Object.freeze(rgba),
    r: rgba[0],
    g: rgba[1],
    b: rgba[2],
    a: rgba[3],
  };
}

export function imageLuminanceMap(image, options = {}) {
  const report = checkedImage(image, options);
  const byteOutput = options.output === 'uint8' || options.byteOutput;
  const out = byteOutput ? new Uint8ClampedArray(report.pixelCount) : new Float32Array(report.pixelCount);
  const normalized = Boolean(options.normalized || options.normalizedOutput);
  for (let i = 0, offset = 0; offset < report.expectedByteLength; i += 1, offset += IMAGE_CHANNEL_COUNT_RGBA) {
    const luminance = imageLuminanceAt(report.data, offset, options);
    const value = normalized ? luminance / 255 : luminance;
    out[i] = byteOutput ? byteChannel(value) : value;
  }
  return out;
}

export function imageEdgeMap(image, options = {}) {
  const report = checkedImage(image, options);
  const luminance = imageLuminanceMap(report, options);
  const out = options.output === 'uint8' || options.byteOutput
    ? new Uint8ClampedArray(report.pixelCount)
    : new Float32Array(report.pixelCount);
  const metric = String(options.metric || 'manhattan').toLowerCase();
  for (let y = 0; y < report.height; y += 1) {
    for (let x = 0; x < report.width; x += 1) {
      const index = y * report.width + x;
      const left = luminance[y * report.width + pixelCoordinate(x - 1, report.width, 'clamp', 'x')];
      const right = luminance[y * report.width + pixelCoordinate(x + 1, report.width, 'clamp', 'x')];
      const up = luminance[pixelCoordinate(y - 1, report.height, 'clamp', 'y') * report.width + x];
      const down = luminance[pixelCoordinate(y + 1, report.height, 'clamp', 'y') * report.width + x];
      const dx = right - left;
      const dy = down - up;
      const magnitude = metric === 'euclidean' ? Math.hypot(dx, dy) : Math.abs(dx) + Math.abs(dy);
      out[index] = out instanceof Uint8ClampedArray ? byteChannel(magnitude) : magnitude;
    }
  }
  return out;
}

export default Object.freeze({
  IMAGE_CHANNEL_COUNT_RGBA,
  IMAGE_CHANNEL_INDEX,
  IMAGE_EDGE_MODES,
  IMAGE_LUMA_REC709_BYTE_WEIGHTS,
  imageAverageColor,
  imageCopyRect,
  imageDataReport,
  imageEdgeMap,
  imageFlipX,
  imageFlipY,
  imageHistogramReport,
  imageLuminanceMap,
  imagePixelOffset,
  imagePremultiplyAlpha,
  imageReadPixel,
  imageSampleBilinear,
  imageSampleNearest,
  imageSwizzleRgba,
  imageUnpremultiplyAlpha,
  imageWritePixel,
});
