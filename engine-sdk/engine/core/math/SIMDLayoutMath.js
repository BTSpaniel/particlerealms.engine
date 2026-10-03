// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * SIMDLayoutMath.js - WebAssembly-style v128 lane metadata and SoA/AoS layout helpers.
 */

import { finiteNumber, safeDiv } from './MathScalar.js';
import {
  alignMemoryOffset,
  isMemoryAligned,
  memoryPaddingForAlignment,
} from './MemoryLayoutMath.js';

export const SIMD_V128_BIT_SIZE = 128;
export const SIMD_V128_BYTE_SIZE = SIMD_V128_BIT_SIZE / 8;
export const SIMD_V128_ALIGNMENT = SIMD_V128_BYTE_SIZE;

const SIMD_LANE_SHAPES = Object.freeze({
  i8x16: Object.freeze({ canonicalShape: 'i8x16', kind: 'integer', laneBits: 8, laneCount: 16, signed: true }),
  u8x16: Object.freeze({ canonicalShape: 'i8x16', kind: 'integer', laneBits: 8, laneCount: 16, signed: false }),
  i16x8: Object.freeze({ canonicalShape: 'i16x8', kind: 'integer', laneBits: 16, laneCount: 8, signed: true }),
  u16x8: Object.freeze({ canonicalShape: 'i16x8', kind: 'integer', laneBits: 16, laneCount: 8, signed: false }),
  i32x4: Object.freeze({ canonicalShape: 'i32x4', kind: 'integer', laneBits: 32, laneCount: 4, signed: true }),
  u32x4: Object.freeze({ canonicalShape: 'i32x4', kind: 'integer', laneBits: 32, laneCount: 4, signed: false }),
  i64x2: Object.freeze({ canonicalShape: 'i64x2', kind: 'integer', laneBits: 64, laneCount: 2, signed: true }),
  u64x2: Object.freeze({ canonicalShape: 'i64x2', kind: 'integer', laneBits: 64, laneCount: 2, signed: false }),
  f32x4: Object.freeze({ canonicalShape: 'f32x4', kind: 'float', laneBits: 32, laneCount: 4, signed: true }),
  f64x2: Object.freeze({ canonicalShape: 'f64x2', kind: 'float', laneBits: 64, laneCount: 2, signed: true }),
});

function positiveInteger(value, name) {
  const number = Number(value);
  if (!Number.isFinite(number) || !Number.isInteger(number) || number <= 0) {
    throw new RangeError(`${name} must be a positive integer`);
  }
  return number;
}

function nonnegativeInteger(value, name) {
  const number = Number(value);
  if (!Number.isFinite(number) || !Number.isInteger(number) || number < 0) {
    throw new RangeError(`${name} must be a nonnegative integer`);
  }
  return number;
}

function normalizeShapeName(shape) {
  return String(shape ?? 'f32x4').replace(/\s+/g, '').toLowerCase();
}

function laneShape(shape) {
  const key = normalizeShapeName(shape);
  const descriptor = SIMD_LANE_SHAPES[key];
  if (!descriptor) {
    throw new RangeError(`unsupported SIMD lane shape: ${shape}`);
  }
  return { requestedShape: key, ...descriptor };
}

function freezeList(values) {
  return Object.freeze(values.map((value) => Object.freeze(value)));
}

function componentNames(componentCount, names) {
  const defaults = ['x', 'y', 'z', 'w'];
  const raw = Array.isArray(names) && names.length >= componentCount ? names : defaults;
  return Object.freeze(Array.from({ length: componentCount }, (_, index) => String(raw[index] ?? `c${index}`)));
}

function readAoSComponent(item, componentIndex, name, fallback) {
  if (item && typeof item.length === 'number' && componentIndex < item.length) {
    return finiteNumber(item[componentIndex], fallback);
  }
  return finiteNumber(item?.[name], fallback);
}

function normalizeSoAPlanes(soa, options = {}) {
  if (Array.isArray(soa)) {
    return soa;
  }
  if (soa?.planes && Array.isArray(soa.planes)) {
    return soa.planes;
  }
  const names = componentNames(positiveInteger(options.componentCount ?? 3, 'componentCount'), options.names);
  return names.map((name) => soa?.[name]).filter(Boolean);
}

export function simdLaneShape(shape = 'f32x4') {
  const descriptor = laneShape(shape);
  const laneByteSize = descriptor.laneBits / 8;
  return {
    schema: 'particle-realms.simd-lane-shape.v1',
    shape: descriptor.requestedShape,
    canonicalShape: descriptor.canonicalShape,
    wasmType: 'v128',
    vectorBits: SIMD_V128_BIT_SIZE,
    vectorByteSize: SIMD_V128_BYTE_SIZE,
    alignment: SIMD_V128_ALIGNMENT,
    laneBits: descriptor.laneBits,
    laneByteSize,
    laneCount: descriptor.laneCount,
    kind: descriptor.kind,
    signed: descriptor.signed,
    integer: descriptor.kind === 'integer',
    float: descriptor.kind === 'float',
    valid: descriptor.laneBits * descriptor.laneCount === SIMD_V128_BIT_SIZE,
  };
}

export function simdVectorByteSize(shape = 'f32x4') {
  return simdLaneShape(shape).vectorByteSize;
}

export function simdLaneByteOffset(shape = 'f32x4', vectorIndex = 0, laneIndex = 0, baseOffset = 0) {
  const descriptor = simdLaneShape(shape);
  const vector = nonnegativeInteger(vectorIndex, 'vectorIndex');
  const lane = nonnegativeInteger(laneIndex, 'laneIndex');
  if (lane >= descriptor.laneCount) {
    throw new RangeError(`laneIndex must be less than ${descriptor.laneCount}`);
  }
  return nonnegativeInteger(baseOffset, 'baseOffset') +
    vector * descriptor.vectorByteSize +
    lane * descriptor.laneByteSize;
}

export function simdVectorAlignmentReport(shape = 'f32x4', byteOffset = 0, options = {}) {
  const descriptor = simdLaneShape(shape);
  const offset = nonnegativeInteger(byteOffset, 'byteOffset');
  const alignment = positiveInteger(options.alignment ?? descriptor.alignment, 'alignment');
  return {
    schema: 'particle-realms.simd-vector-alignment.v1',
    shape: descriptor.shape,
    canonicalShape: descriptor.canonicalShape,
    byteOffset: offset,
    alignment,
    vectorByteSize: descriptor.vectorByteSize,
    aligned: isMemoryAligned(offset, alignment),
    alignedOffset: alignMemoryOffset(offset, alignment),
    paddingBytes: memoryPaddingForAlignment(offset, alignment),
  };
}

export function simdChunkPlan(elementCount, shape = 'f32x4') {
  const count = nonnegativeInteger(elementCount, 'elementCount');
  const descriptor = simdLaneShape(shape);
  const fullVectorCount = Math.floor(count / descriptor.laneCount);
  const tailLaneCount = count % descriptor.laneCount;
  const vectorCount = count === 0 ? 0 : fullVectorCount + (tailLaneCount > 0 ? 1 : 0);
  const paddedElementCount = vectorCount * descriptor.laneCount;
  return {
    schema: 'particle-realms.simd-chunk-plan.v1',
    shape: descriptor.shape,
    canonicalShape: descriptor.canonicalShape,
    elementCount: count,
    laneCount: descriptor.laneCount,
    laneByteSize: descriptor.laneByteSize,
    vectorByteSize: descriptor.vectorByteSize,
    fullVectorCount,
    tailLaneCount,
    vectorCount,
    paddedElementCount,
    paddedLaneCount: paddedElementCount - count,
    vectorizedElementCount: fullVectorCount * descriptor.laneCount,
    byteSize: vectorCount * descriptor.vectorByteSize,
    utilizationRatio: paddedElementCount === 0 ? 1 : safeDiv(count, paddedElementCount, 0),
    requiresTailMask: tailLaneCount > 0,
  };
}

export function simdLaneMask(shape = 'f32x4', enabledLanes = 'all') {
  const descriptor = simdLaneShape(shape);
  const lanes = new Uint8Array(descriptor.laneCount);
  if (enabledLanes === true || enabledLanes === 'all' || enabledLanes === undefined) {
    lanes.fill(1);
  } else if (enabledLanes === false || enabledLanes === 'none' || enabledLanes === null) {
    lanes.fill(0);
  } else if (Array.isArray(enabledLanes) || ArrayBuffer.isView(enabledLanes)) {
    const values = Array.from(enabledLanes);
    if (values.length === descriptor.laneCount && values.every((value) => typeof value === 'boolean')) {
      for (let i = 0; i < values.length; i++) lanes[i] = values[i] ? 1 : 0;
    } else {
      for (const value of values) {
        const lane = nonnegativeInteger(value, 'enabledLane');
        if (lane >= descriptor.laneCount) {
          throw new RangeError(`enabledLane must be less than ${descriptor.laneCount}`);
        }
        lanes[lane] = 1;
      }
    }
  } else {
    throw new TypeError('enabledLanes must be all, none, a boolean, or an array-like list');
  }

  let maskBits = 0;
  let activeLaneCount = 0;
  for (let i = 0; i < lanes.length; i++) {
    if (lanes[i]) {
      maskBits |= (1 << i);
      activeLaneCount += 1;
    }
  }

  return {
    schema: 'particle-realms.simd-lane-mask.v1',
    shape: descriptor.shape,
    canonicalShape: descriptor.canonicalShape,
    laneCount: descriptor.laneCount,
    lanes,
    maskBits,
    activeLaneCount,
    any: activeLaneCount > 0,
    all: activeLaneCount === descriptor.laneCount,
  };
}

export function simdTailLaneMask(elementCount, shape = 'f32x4') {
  const plan = simdChunkPlan(elementCount, shape);
  const activeLanes = plan.elementCount === 0
    ? 0
    : plan.tailLaneCount === 0 ? plan.laneCount : plan.tailLaneCount;
  const mask = simdLaneMask(shape, Array.from({ length: activeLanes }, (_, index) => index));
  return {
    ...mask,
    schema: 'particle-realms.simd-tail-lane-mask.v1',
    elementCount: plan.elementCount,
    tailLaneCount: plan.tailLaneCount,
    finalVectorFull: plan.elementCount > 0 && plan.tailLaneCount === 0,
  };
}

export function simdSoALayoutReport(componentCount, elementCount, options = {}) {
  const components = positiveInteger(componentCount, 'componentCount');
  const count = nonnegativeInteger(elementCount, 'elementCount');
  const scalarByteSize = positiveInteger(options.scalarByteSize ?? simdLaneShape(options.shape ?? 'f32x4').laneByteSize, 'scalarByteSize');
  const alignment = positiveInteger(options.alignment ?? SIMD_V128_ALIGNMENT, 'alignment');
  const names = componentNames(components, options.names);
  const payloadBytesPerPlane = count * scalarByteSize;
  const planeStride = alignMemoryOffset(payloadBytesPerPlane, alignment);
  const planes = Array.from({ length: components }, (_, index) => ({
    name: names[index],
    component: index,
    offset: planeStride * index,
    byteOffset: planeStride * index,
    payloadBytes: payloadBytesPerPlane,
    byteSize: planeStride,
    paddingBytes: planeStride - payloadBytesPerPlane,
  }));
  return {
    schema: 'particle-realms.simd-soa-layout.v1',
    componentCount: components,
    elementCount: count,
    scalarByteSize,
    alignment,
    planeStride,
    byteSize: planeStride * components,
    payloadBytes: payloadBytesPerPlane * components,
    paddingBytes: (planeStride - payloadBytesPerPlane) * components,
    planes: freezeList(planes),
  };
}

export function simdAoSToSoA(vectors, options = {}) {
  if (!vectors || typeof vectors.length !== 'number') {
    throw new TypeError('vectors must be an array-like list');
  }
  const componentCount = positiveInteger(options.componentCount ?? 3, 'componentCount');
  const names = componentNames(componentCount, options.names);
  const fallback = finiteNumber(options.fallback, 0);
  const ArrayType = options.ArrayType ?? Float32Array;
  const flatInput = ArrayBuffer.isView(vectors) && options.flat !== false;
  const elementCount = flatInput
    ? Math.floor(vectors.length / componentCount)
    : vectors.length;
  const planes = Array.from({ length: componentCount }, () => new ArrayType(elementCount));

  for (let element = 0; element < elementCount; element++) {
    for (let component = 0; component < componentCount; component++) {
      const value = flatInput
        ? vectors[element * componentCount + component]
        : readAoSComponent(vectors[element], component, names[component], fallback);
      planes[component][element] = finiteNumber(value, fallback);
    }
  }

  return {
    schema: 'particle-realms.simd-aos-to-soa.v1',
    componentCount,
    elementCount,
    count: elementCount,
    names,
    planes,
    layout: simdSoALayoutReport(componentCount, elementCount, {
      scalarByteSize: planes[0]?.BYTES_PER_ELEMENT ?? 4,
      alignment: options.alignment ?? SIMD_V128_ALIGNMENT,
      names,
    }),
  };
}

export function simdSoAToAoS(soa, options = {}) {
  const componentCount = positiveInteger(options.componentCount ?? soa?.componentCount ?? 3, 'componentCount');
  const planes = normalizeSoAPlanes(soa, { ...options, componentCount });
  if (planes.length < componentCount) {
    throw new RangeError(`soa must provide at least ${componentCount} planes`);
  }
  const count = options.elementCount === undefined
    ? Math.min(...planes.slice(0, componentCount).map((plane) => plane.length ?? 0))
    : nonnegativeInteger(options.elementCount, 'elementCount');
  const fallback = finiteNumber(options.fallback, 0);

  if (options.asTypedArray === true) {
    const ArrayType = options.ArrayType ?? Float32Array;
    const out = new ArrayType(count * componentCount);
    for (let element = 0; element < count; element++) {
      for (let component = 0; component < componentCount; component++) {
        out[element * componentCount + component] = finiteNumber(planes[component][element], fallback);
      }
    }
    return out;
  }

  return Array.from({ length: count }, (_, element) => (
    Array.from({ length: componentCount }, (_, component) => finiteNumber(planes[component][element], fallback))
  ));
}

export function simdScalarFallbackReport(elementCount, shape = 'f32x4', options = {}) {
  const plan = simdChunkPlan(elementCount, shape);
  const scalarOpsPerElement = positiveInteger(options.scalarOpsPerElement ?? 1, 'scalarOpsPerElement');
  return {
    schema: 'particle-realms.simd-scalar-fallback.v1',
    shape: plan.shape,
    canonicalShape: plan.canonicalShape,
    elementCount: plan.elementCount,
    laneCount: plan.laneCount,
    fullVectorCount: plan.fullVectorCount,
    vectorCount: plan.vectorCount,
    scalarTailElements: plan.tailLaneCount,
    scalarEquivalentOperations: plan.elementCount * scalarOpsPerElement,
    vectorLaneOperations: plan.paddedElementCount * scalarOpsPerElement,
    tailScalarOperations: plan.tailLaneCount * scalarOpsPerElement,
    utilizationRatio: plan.utilizationRatio,
    requiresTailMask: plan.requiresTailMask,
  };
}
