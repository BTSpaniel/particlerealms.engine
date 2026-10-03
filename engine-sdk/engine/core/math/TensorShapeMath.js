// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

// TensorShapeMath.js - reusable tensor shape, broadcast, stride, dtype, and graph memory reports.

const DEFAULT_BYTE_ALIGNMENT = 1;

export const TENSOR_DTYPE_BYTE_SIZE = Object.freeze({
  bool: 1,
  uint8: 1,
  int8: 1,
  uint16: 2,
  int16: 2,
  float16: 2,
  fp16: 2,
  bfloat16: 2,
  bf16: 2,
  uint32: 4,
  int32: 4,
  float32: 4,
  fp32: 4,
  uint64: 8,
  int64: 8,
  float64: 8,
  fp64: 8,
});

function finiteInteger(value, name) {
  const number = Number(value);
  if (!Number.isFinite(number) || !Number.isInteger(number)) {
    throw new RangeError(`${name} must be a finite integer`);
  }
  return number;
}

function positiveInteger(value, name) {
  const number = finiteInteger(value, name);
  if (number <= 0) {
    throw new RangeError(`${name} must be positive`);
  }
  return number;
}

function nonnegativeInteger(value, name) {
  const number = finiteInteger(value, name);
  if (number < 0) {
    throw new RangeError(`${name} must be nonnegative`);
  }
  return number;
}

function normalizeShapeList(shape, options = {}, name = 'shape') {
  if (!Array.isArray(shape) && !ArrayBuffer.isView(shape)) {
    throw new TypeError(`${name} must be an array-like shape`);
  }
  const allowZero = options.allowZero === true;
  const out = [];
  for (let i = 0; i < shape.length; i++) {
    const dim = finiteInteger(shape[i], `${name}[${i}]`);
    if (dim < 0 || (!allowZero && dim === 0)) {
      throw new RangeError(`${name}[${i}] must be ${allowZero ? 'nonnegative' : 'positive'}`);
    }
    out.push(dim);
  }
  return Object.freeze(out);
}

function normalizeShapeArgs(inputShapes) {
  if (inputShapes.length === 1 && Array.isArray(inputShapes[0]) && inputShapes[0].every((shape) => Array.isArray(shape) || ArrayBuffer.isView(shape))) {
    return inputShapes[0];
  }
  return inputShapes;
}

function alignBytes(byteCount, alignment = DEFAULT_BYTE_ALIGNMENT) {
  const bytes = nonnegativeInteger(byteCount, 'byteCount');
  const align = positiveInteger(alignment, 'alignment');
  return Math.ceil(bytes / align) * align;
}

export function normalizeTensorShape(shape, options = {}) {
  return normalizeShapeList(shape, options);
}

export function tensorElementCount(shape, options = {}) {
  return normalizeShapeList(shape, options).reduce((count, dim) => count * dim, 1);
}

export function tensorDTypeByteSize(dtype) {
  const key = String(dtype ?? '').trim().toLowerCase();
  const size = TENSOR_DTYPE_BYTE_SIZE[key];
  if (!size) {
    throw new RangeError(`unsupported tensor dtype: ${dtype}`);
  }
  return size;
}

export function contiguousStrides(shape, options = {}) {
  const dims = normalizeShapeList(shape, options);
  const layout = options.layout ?? 'row-major';
  const strides = new Array(dims.length);
  if (layout === 'column-major') {
    let stride = 1;
    for (let i = 0; i < dims.length; i++) {
      strides[i] = stride;
      stride *= dims[i];
    }
  } else {
    let stride = 1;
    for (let i = dims.length - 1; i >= 0; i--) {
      strides[i] = stride;
      stride *= dims[i];
    }
  }
  return Object.freeze(strides);
}

export function tensorIndexToOffset(indices, strides, options = {}) {
  const indexList = normalizeShapeList(indices, { allowZero: true }, 'indices');
  const strideList = normalizeShapeList(strides, { allowZero: true }, 'strides');
  if (indexList.length !== strideList.length) {
    throw new RangeError('indices and strides must have matching rank');
  }
  let offset = nonnegativeInteger(options.baseOffset ?? 0, 'baseOffset');
  for (let i = 0; i < indexList.length; i++) {
    offset += indexList[i] * strideList[i];
  }
  return offset;
}

export function tensorOffsetToIndices(offset, shape, options = {}) {
  const dims = normalizeShapeList(shape, options);
  let remaining = nonnegativeInteger(offset, 'offset');
  const strides = options.strides ? normalizeShapeList(options.strides, { allowZero: true }, 'strides') : contiguousStrides(dims, options);
  if (strides.length !== dims.length) {
    throw new RangeError('strides and shape must have matching rank');
  }
  const indices = new Array(dims.length);
  for (let i = 0; i < dims.length; i++) {
    const stride = strides[i];
    indices[i] = stride > 0 ? Math.floor(remaining / stride) % dims[i] : 0;
    if (stride > 0) remaining -= indices[i] * stride;
  }
  return Object.freeze(indices);
}

export function broadcastShapes(...inputShapes) {
  const shapes = normalizeShapeArgs(inputShapes).map((shape, index) => normalizeShapeList(shape, {}, `shapes[${index}]`));
  if (shapes.length === 0) return Object.freeze([]);
  const outputRank = Math.max(...shapes.map((shape) => shape.length));
  const output = new Array(outputRank);
  for (let axis = 0; axis < outputRank; axis++) {
    let dim = 1;
    for (const shape of shapes) {
      const shapeAxis = shape.length - outputRank + axis;
      const value = shapeAxis < 0 ? 1 : shape[shapeAxis];
      if (value !== 1 && dim !== 1 && value !== dim) {
        throw new RangeError(`shapes are not broadcastable at axis ${axis}`);
      }
      if (value !== 1) dim = value;
    }
    output[axis] = dim;
  }
  return Object.freeze(output);
}

export function broadcastReport(inputShapes) {
  try {
    const rawShapes = Array.isArray(inputShapes) && inputShapes.every((shape) => Array.isArray(shape) || ArrayBuffer.isView(shape))
      ? inputShapes
      : Array.from(arguments);
    const shapes = rawShapes.map((shape, index) => normalizeShapeList(shape, {}, `shapes[${index}]`));
    const outputShape = broadcastShapes(shapes);
    return {
      valid: true,
      shapes,
      outputShape,
      outputRank: outputShape.length,
      outputElementCount: tensorElementCount(outputShape),
      error: '',
    };
  } catch (error) {
    return {
      valid: false,
      shapes: [],
      outputShape: [],
      outputRank: 0,
      outputElementCount: 0,
      error: String(error?.message ?? error),
    };
  }
}

export function unidirectionalBroadcastShape(shapeFrom, shapeTo) {
  const from = normalizeShapeList(shapeFrom, {}, 'shapeFrom');
  const to = normalizeShapeList(shapeTo, {}, 'shapeTo');
  if (from.length > to.length) {
    throw new RangeError('shapeFrom rank cannot exceed shapeTo rank');
  }
  const rankOffset = to.length - from.length;
  for (let i = 0; i < to.length; i++) {
    const sourceDim = i < rankOffset ? 1 : from[i - rankOffset];
    if (sourceDim !== 1 && sourceDim !== to[i]) {
      throw new RangeError(`shapeFrom cannot broadcast to shapeTo at axis ${i}`);
    }
  }
  return Object.freeze([...to]);
}

export function blockwiseBroadcastReport(shapeFrom, shapeTo) {
  const from = normalizeShapeList(shapeFrom, {}, 'shapeFrom');
  const to = normalizeShapeList(shapeTo, {}, 'shapeTo');
  const errors = [];
  if (from.length !== to.length) {
    errors.push('rank-mismatch');
  }
  const factors = [];
  const rank = Math.min(from.length, to.length);
  for (let i = 0; i < rank; i++) {
    if (to[i] < from[i] || to[i] % from[i] !== 0) {
      errors.push(`axis-${i}`);
      factors.push(0);
    } else {
      factors.push(to[i] / from[i]);
    }
  }
  return {
    valid: errors.length === 0,
    shapeFrom: from,
    shapeTo: to,
    outputShape: errors.length === 0 ? Object.freeze([...to]) : Object.freeze([]),
    factors: Object.freeze(factors),
    errors: Object.freeze(errors),
  };
}

export function reshapeReport(inputShape, targetShape, options = {}) {
  const input = normalizeShapeList(inputShape, options, 'inputShape');
  if (!Array.isArray(targetShape) && !ArrayBuffer.isView(targetShape)) {
    throw new TypeError('targetShape must be an array-like shape');
  }
  const target = Object.freeze(Array.from(targetShape, (value, index) => finiteInteger(value, `targetShape[${index}]`)));
  const inputElementCount = tensorElementCount(input, options);
  let knownProduct = 1;
  let inferredAxis = -1;
  const outputShape = [];
  for (let i = 0; i < target.length; i++) {
    const dim = finiteInteger(target[i], `targetShape[${i}]`);
    if (dim === -1) {
      if (inferredAxis !== -1) {
        return { valid: false, inputShape: input, targetShape: target, outputShape: [], inputElementCount, outputElementCount: 0, inferredAxis: -1, error: 'multiple-inferred-axes' };
      }
      inferredAxis = i;
      outputShape.push(1);
    } else if (dim === 0 && options.copyZeroFromInput === true) {
      if (i >= input.length) {
        return { valid: false, inputShape: input, targetShape: target, outputShape: [], inputElementCount, outputElementCount: 0, inferredAxis: -1, error: 'zero-copy-axis-out-of-range' };
      }
      outputShape.push(input[i]);
      knownProduct *= input[i];
    } else if (dim <= 0) {
      return { valid: false, inputShape: input, targetShape: target, outputShape: [], inputElementCount, outputElementCount: 0, inferredAxis: -1, error: 'invalid-target-dimension' };
    } else {
      outputShape.push(dim);
      knownProduct *= dim;
    }
  }
  if (inferredAxis !== -1) {
    if (knownProduct === 0 || inputElementCount % knownProduct !== 0) {
      return { valid: false, inputShape: input, targetShape: target, outputShape: [], inputElementCount, outputElementCount: 0, inferredAxis, error: 'cannot-infer-dimension' };
    }
    outputShape[inferredAxis] = inputElementCount / knownProduct;
  }
  const outputElementCount = outputShape.reduce((count, dim) => count * dim, 1);
  return {
    valid: inputElementCount === outputElementCount,
    inputShape: input,
    targetShape: target,
    outputShape: Object.freeze(outputShape),
    inputElementCount,
    outputElementCount,
    inferredAxis,
    error: inputElementCount === outputElementCount ? '' : 'element-count-mismatch',
  };
}

export function tensorLayoutReport(shape, options = {}) {
  const dims = normalizeShapeList(shape, options);
  const strides = options.strides ? normalizeShapeList(options.strides, { allowZero: true }, 'strides') : contiguousStrides(dims, options);
  if (strides.length !== dims.length) {
    throw new RangeError('strides and shape must have matching rank');
  }
  const expectedStrides = contiguousStrides(dims, options);
  const contiguous = strides.every((stride, index) => stride === expectedStrides[index]);
  let maxElementOffset = 0;
  for (let i = 0; i < dims.length; i++) {
    maxElementOffset += (dims[i] - 1) * strides[i];
  }
  const elementCount = tensorElementCount(dims, options);
  const spanElements = dims.length === 0 ? 1 : maxElementOffset + 1;
  const dtype = options.dtype ?? 'float32';
  const bytesPerElement = tensorDTypeByteSize(dtype);
  const byteOffset = nonnegativeInteger(options.byteOffset ?? 0, 'byteOffset');
  const byteLength = spanElements * bytesPerElement;
  const byteAlignment = positiveInteger(options.byteAlignment ?? DEFAULT_BYTE_ALIGNMENT, 'byteAlignment');
  const alignedByteLength = alignBytes(byteLength, byteAlignment);
  return {
    shape: dims,
    rank: dims.length,
    strides: Object.freeze([...strides]),
    expectedStrides,
    contiguous,
    dense: contiguous && spanElements === elementCount,
    elementCount,
    spanElements,
    dtype,
    bytesPerElement,
    byteOffset,
    byteLength,
    byteAlignment,
    alignedByteLength,
    paddingBytes: alignedByteLength - byteLength,
  };
}

export function tensorBufferSizeReport(shape, dtype = 'float32', options = {}) {
  const dims = normalizeShapeList(shape, options);
  const bytesPerElement = tensorDTypeByteSize(dtype);
  const elementCount = tensorElementCount(dims, options);
  const byteLength = elementCount * bytesPerElement;
  const byteAlignment = positiveInteger(options.byteAlignment ?? DEFAULT_BYTE_ALIGNMENT, 'byteAlignment');
  const alignedByteLength = alignBytes(byteLength, byteAlignment);
  return {
    shape: dims,
    dtype,
    bytesPerElement,
    elementCount,
    byteLength,
    byteAlignment,
    alignedByteLength,
    paddingBytes: alignedByteLength - byteLength,
  };
}

export function reductionShape(shape, axes, options = {}) {
  const dims = normalizeShapeList(shape, options);
  const axisList = Array.isArray(axes) || ArrayBuffer.isView(axes) ? Array.from(axes) : [axes];
  const normalizedAxes = [...new Set(axisList.map((axis) => {
    const value = finiteInteger(axis, 'axis');
    const normalized = value < 0 ? dims.length + value : value;
    if (normalized < 0 || normalized >= dims.length) {
      throw new RangeError(`axis ${axis} is out of range`);
    }
    return normalized;
  }))].sort((a, b) => a - b);
  const keepDims = options.keepDims === true;
  const outputShape = keepDims
    ? dims.map((dim, index) => (normalizedAxes.includes(index) ? 1 : dim))
    : dims.filter((_, index) => !normalizedAxes.includes(index));
  return {
    inputShape: dims,
    axes: Object.freeze(normalizedAxes),
    keepDims,
    outputShape: Object.freeze(outputShape),
    outputElementCount: tensorElementCount(outputShape),
  };
}

export function matmulShapeReport(shapeA, shapeB) {
  const a = normalizeShapeList(shapeA, {}, 'shapeA');
  const b = normalizeShapeList(shapeB, {}, 'shapeB');
  if (a.length < 2 || b.length < 2) {
    return { valid: false, shapeA: a, shapeB: b, outputShape: [], error: 'matmul-rank' };
  }
  const m = a[a.length - 2];
  const kA = a[a.length - 1];
  const kB = b[b.length - 2];
  const n = b[b.length - 1];
  if (kA !== kB) {
    return { valid: false, shapeA: a, shapeB: b, outputShape: [], error: 'matmul-inner-dimension' };
  }
  try {
    const batchShape = broadcastShapes(a.slice(0, -2), b.slice(0, -2));
    const outputShape = Object.freeze([...batchShape, m, n]);
    return {
      valid: true,
      shapeA: a,
      shapeB: b,
      batchShape,
      outputShape,
      outputElementCount: tensorElementCount(outputShape),
      error: '',
    };
  } catch (error) {
    return { valid: false, shapeA: a, shapeB: b, outputShape: [], error: String(error?.message ?? error) };
  }
}

export function elementwiseShapeReport(inputShapes) {
  return broadcastReport(inputShapes);
}

export function tensorGraphMemoryReport(tensors, options = {}) {
  if (!Array.isArray(tensors)) {
    throw new TypeError('tensors must be an array');
  }
  const byteAlignment = positiveInteger(options.byteAlignment ?? DEFAULT_BYTE_ALIGNMENT, 'byteAlignment');
  const reports = [];
  let totalBytes = 0;
  let uniqueBytes = 0;
  const seenNames = new Set();
  for (let i = 0; i < tensors.length; i++) {
    const tensor = tensors[i] ?? {};
    const name = String(tensor.name ?? `tensor-${i}`);
    const dtype = tensor.dtype ?? 'float32';
    const report = tensorBufferSizeReport(tensor.shape ?? [], dtype, { byteAlignment, allowZero: options.allowZero === true });
    const aliasOf = tensor.aliasOf == null ? null : String(tensor.aliasOf);
    const unique = aliasOf === null || !seenNames.has(aliasOf);
    reports.push({ name, aliasOf, unique, ...report });
    totalBytes += report.alignedByteLength;
    if (unique) uniqueBytes += report.alignedByteLength;
    seenNames.add(name);
  }
  return {
    tensorCount: reports.length,
    byteAlignment,
    totalBytes,
    uniqueBytes,
    aliasBytes: totalBytes - uniqueBytes,
    tensors: Object.freeze(reports),
  };
}

export default {
  TENSOR_DTYPE_BYTE_SIZE,
  normalizeTensorShape,
  tensorElementCount,
  tensorDTypeByteSize,
  contiguousStrides,
  tensorIndexToOffset,
  tensorOffsetToIndices,
  broadcastShapes,
  broadcastReport,
  unidirectionalBroadcastShape,
  blockwiseBroadcastReport,
  reshapeReport,
  tensorLayoutReport,
  tensorBufferSizeReport,
  reductionShape,
  matmulShapeReport,
  elementwiseShapeReport,
  tensorGraphMemoryReport,
};
