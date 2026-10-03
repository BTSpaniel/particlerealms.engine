// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha
import { normalizeTensorShape, tensorElementCount } from './TensorShapeMath.js';

const MAX_ELEMENTS = 16_777_216;
function spatialShape(shape) {
  const normalized = normalizeTensorShape(shape);
  if (normalized.length !== 4 || normalized.some(size => size > 65536) || tensorElementCount(normalized) > MAX_ELEMENTS) throw new RangeError('Declare bounded NHWC tensor dimensions');
  return normalized;
}
function tensorData(data, length) {
  if (!(data instanceof Float32Array) || data.length !== length || !data.every(Number.isFinite)) throw new TypeError('Spatial tensor data must be finite Float32 values with matching dimensions');
}
function pair(value, name, allowZero = false) {
  if (!Array.isArray(value) || value.length !== 2 || value.some(size => !Number.isInteger(size) || size < (allowZero ? 0 : 1) || size > 64)) throw new TypeError(`Declare bounded ${name} height and width`);
  return value;
}
function patchLayout(shape, { kernel = [3, 3], stride = [1, 1], padding = [0, 0] } = {}) {
  const dimensions = spatialShape(shape); pair(kernel, 'kernel'); pair(stride, 'stride'); pair(padding, 'padding', true);
  const [batch, height, width, channels] = dimensions, outputHeight = Math.floor((height + 2 * padding[0] - kernel[0]) / stride[0]) + 1, outputWidth = Math.floor((width + 2 * padding[1] - kernel[1]) / stride[1]) + 1;
  const rows = batch * outputHeight * outputWidth, columns = kernel[0] * kernel[1] * channels;
  if (outputHeight < 1 || outputWidth < 1 || !Number.isSafeInteger(rows * columns) || rows * columns > MAX_ELEMENTS) throw new RangeError('Spatial patch matrix exceeds its declared element budget');
  return { shape: dimensions, kernel: [...kernel], stride: [...stride], padding: [...padding], outputHeight, outputWidth, rows, columns };
}

/** NHWC patch matrix consumed by the existing AGI dense/matmul implementation. */
export function tensorSpatialColumns(data, shape, options = {}) {
  const layout = patchLayout(shape, options), { signal } = options; tensorData(data, tensorElementCount(layout.shape)); signal?.throwIfAborted();
  const [batch, height, width, channels] = layout.shape, result = new Float32Array(layout.rows * layout.columns); let offset = 0;
  for (let sample = 0; sample < batch; sample++) for (let y = 0; y < layout.outputHeight; y++) {
    signal?.throwIfAborted();
    for (let x = 0; x < layout.outputWidth; x++) for (let ky = 0; ky < layout.kernel[0]; ky++) for (let kx = 0; kx < layout.kernel[1]; kx++) {
      const sy = y * layout.stride[0] + ky - layout.padding[0], sx = x * layout.stride[1] + kx - layout.padding[1];
      if (sy >= 0 && sy < height && sx >= 0 && sx < width) result.set(data.subarray(((sample * height + sy) * width + sx) * channels, ((sample * height + sy) * width + sx + 1) * channels), offset);
      offset += channels;
    }
  }
  return { data: result, shape: [layout.rows, layout.columns], layout };
}

/** Exact adjoint of patch extraction, accumulating overlapping input gradients. */
export function tensorSpatialColumnsGradient(gradient, shape, options = {}) {
  const layout = patchLayout(shape, options), { signal } = options; tensorData(gradient, layout.rows * layout.columns); signal?.throwIfAborted();
  const [batch, height, width, channels] = layout.shape, result = new Float32Array(tensorElementCount(layout.shape)); let offset = 0;
  for (let sample = 0; sample < batch; sample++) for (let y = 0; y < layout.outputHeight; y++) {
    signal?.throwIfAborted();
    for (let x = 0; x < layout.outputWidth; x++) for (let ky = 0; ky < layout.kernel[0]; ky++) for (let kx = 0; kx < layout.kernel[1]; kx++) {
      const sy = y * layout.stride[0] + ky - layout.padding[0], sx = x * layout.stride[1] + kx - layout.padding[1];
      if (sy >= 0 && sy < height && sx >= 0 && sx < width) for (let channel = 0; channel < channels; channel++) result[((sample * height + sy) * width + sx) * channels + channel] += gradient[offset + channel];
      offset += channels;
    }
  }
  if (!result.every(Number.isFinite)) throw new RangeError('Accumulated spatial gradient exceeds Float32'); return result;
}

/** Non-overlapping NHWC average pooling; incomplete border cells are rejected. */
export function tensorSpatialAveragePool(data, shape, { window = [2, 2], signal } = {}) {
  const dimensions = spatialShape(shape); pair(window, 'pool window'); tensorData(data, tensorElementCount(dimensions)); signal?.throwIfAborted();
  const [batch, height, width, channels] = dimensions;
  if (height % window[0] || width % window[1]) throw new RangeError('Average pooling requires complete spatial cells');
  const outputShape = [batch, height / window[0], width / window[1], channels], result = new Float32Array(tensorElementCount(outputShape)), count = window[0] * window[1]; let output = 0;
  for (let sample = 0; sample < batch; sample++) for (let y = 0; y < outputShape[1]; y++) {
    signal?.throwIfAborted();
    for (let x = 0; x < outputShape[2]; x++) for (let channel = 0; channel < channels; channel++) {
      let sum = 0; for (let py = 0; py < window[0]; py++) for (let px = 0; px < window[1]; px++) sum += data[((sample * height + y * window[0] + py) * width + x * window[1] + px) * channels + channel];
      result[output++] = sum / count;
    }
  }
  return { data: result, shape: outputShape };
}

/** Average-pooling adjoint in the same NHWC coordinate system. */
export function tensorSpatialAveragePoolGradient(gradient, shape, { window = [2, 2], signal } = {}) {
  const dimensions = spatialShape(shape); pair(window, 'pool window'); const [batch, height, width, channels] = dimensions;
  if (height % window[0] || width % window[1]) throw new RangeError('Average pooling requires complete spatial cells');
  const pooledHeight = height / window[0], pooledWidth = width / window[1]; tensorData(gradient, batch * pooledHeight * pooledWidth * channels); signal?.throwIfAborted();
  const result = new Float32Array(tensorElementCount(dimensions)), count = window[0] * window[1];
  for (let sample = 0; sample < batch; sample++) for (let y = 0; y < height; y++) {
    signal?.throwIfAborted();
    for (let x = 0; x < width; x++) for (let channel = 0; channel < channels; channel++) result[((sample * height + y) * width + x) * channels + channel] = gradient[((sample * pooledHeight + Math.floor(y / window[0])) * pooledWidth + Math.floor(x / window[1])) * channels + channel] / count;
  }
  return result;
}
