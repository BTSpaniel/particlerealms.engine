// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

// MemoryLayoutMath.js - byte alignment, struct, interleaved, planar, WGSL, and std140 layout reports.

import {
  INDIRECT_ALIGN,
  STORAGE_ALIGN,
  TYPE_SIZES,
  UNIFORM_ALIGN,
  alignTo as gpuAlignTo,
  isAligned as gpuIsAligned,
  paddingFor as gpuPaddingFor,
} from '../gpu/BufferLayouts.js';
import { parseWGSLStruct } from '../gpu/WGSLStructLayout.js';
import { calcWGSLStructSize } from '../gpu/WGSLStructSize.js';
import {
  STD140_TYPES,
  Std140StructBuilder,
} from '../../render/materials/Std140Layout.js';

export const MEMORY_LAYOUT_ALIGNMENTS = Object.freeze({
  byte: 1,
  scalar: 4,
  indirect: INDIRECT_ALIGN,
  storage: STORAGE_ALIGN,
  uniform: UNIFORM_ALIGN,
  std140: UNIFORM_ALIGN,
  wgslUniform: UNIFORM_ALIGN,
});

const MEMORY_LAYOUT_TYPE_ALIASES = Object.freeze({
  'vec2<f32>': 'vec2f',
  'vec2<i32>': 'vec2i',
  'vec2<u32>': 'vec2u',
  'vec3<f32>': 'vec3f',
  'vec3<i32>': 'vec3i',
  'vec3<u32>': 'vec3u',
  'vec4<f32>': 'vec4f',
  'vec4<i32>': 'vec4i',
  'vec4<u32>': 'vec4u',
  'mat2x2<f32>': 'mat2x2f',
  'mat3x3<f32>': 'mat3x3f',
  'mat4x4<f32>': 'mat4x4f',
});

function freezeList(values) {
  return Object.freeze(values.map((value) => Object.freeze(value)));
}

function finiteInteger(value, name) {
  const number = Number(value);
  if (!Number.isFinite(number) || !Number.isInteger(number)) {
    throw new RangeError(`${name} must be a finite integer`);
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

function positiveInteger(value, name) {
  const number = finiteInteger(value, name);
  if (number <= 0) {
    throw new RangeError(`${name} must be positive`);
  }
  return number;
}

function normalizeTypeName(type) {
  const key = String(type ?? '').replace(/\s+/g, '').trim();
  return MEMORY_LAYOUT_TYPE_ALIASES[key] ?? key;
}

function byteSizeForType(type) {
  const key = normalizeTypeName(type);
  if (STD140_TYPES[key]) return STD140_TYPES[key].size;
  if (TYPE_SIZES[key]) return TYPE_SIZES[key];
  throw new RangeError(`unsupported memory layout type: ${type}`);
}

function alignmentForType(type, fallback = 4) {
  const key = normalizeTypeName(type);
  if (STD140_TYPES[key]) return STD140_TYPES[key].align;
  const byteSize = TYPE_SIZES[key];
  if (byteSize) return Math.min(Math.max(4, byteSize), 16);
  return fallback;
}

function normalizeFields(fields) {
  if (!Array.isArray(fields) && !ArrayBuffer.isView(fields)) {
    throw new TypeError('fields must be an array-like list');
  }
  return Array.from(fields);
}

function normalizeField(field, index, options) {
  if (!field || typeof field !== 'object') {
    throw new TypeError(`fields[${index}] must be an object`);
  }
  const name = String(field.name ?? `field${index}`);
  const type = field.type === undefined ? null : normalizeTypeName(field.type);
  const scalarByteSize = field.byteSize === undefined
    ? byteSizeForType(type)
    : positiveInteger(field.byteSize, `fields[${index}].byteSize`);
  const alignment = positiveInteger(
    field.alignment ?? field.align ?? (type ? alignmentForType(type, options.defaultFieldAlignment) : options.defaultFieldAlignment),
    `fields[${index}].alignment`
  );
  const count = positiveInteger(field.count ?? field.arrayLength ?? field.elementCount ?? 1, `fields[${index}].count`);
  const elementStride = field.elementStride === undefined
    ? (count > 1 ? gpuAlignTo(scalarByteSize, field.arrayStrideAlignment ?? alignment) : scalarByteSize)
    : positiveInteger(field.elementStride, `fields[${index}].elementStride`);
  const byteSize = count > 1 ? elementStride * count : scalarByteSize;

  return {
    name,
    type,
    byteSize,
    elementByteSize: scalarByteSize,
    elementStride,
    count,
    alignment,
  };
}

export function memoryLayoutAlignmentForKind(kind, fallback = 1) {
  const key = String(kind ?? '').trim();
  return MEMORY_LAYOUT_ALIGNMENTS[key] ?? positiveInteger(fallback, 'fallback');
}

export function alignMemoryOffset(offset, alignment) {
  return gpuAlignTo(nonnegativeInteger(offset, 'offset'), positiveInteger(alignment, 'alignment'));
}

export function memoryPaddingForAlignment(offset, alignment) {
  return gpuPaddingFor(nonnegativeInteger(offset, 'offset'), positiveInteger(alignment, 'alignment'));
}

export function isMemoryAligned(offset, alignment) {
  return gpuIsAligned(nonnegativeInteger(offset, 'offset'), positiveInteger(alignment, 'alignment'));
}

export function alignedMemoryByteSize(byteSize, alignment) {
  return alignMemoryOffset(byteSize, alignment);
}

export function memoryFieldLayout(fields, options = {}) {
  const rawFields = normalizeFields(fields);
  const defaultFieldAlignment = positiveInteger(options.defaultFieldAlignment ?? 4, 'defaultFieldAlignment');
  const normalizedOptions = { ...options, defaultFieldAlignment };
  const baseOffset = nonnegativeInteger(options.baseOffset ?? 0, 'baseOffset');
  const finalAlignment = options.finalAlignment === undefined ? null : positiveInteger(options.finalAlignment, 'finalAlignment');
  let offset = baseOffset;
  let maxFieldAlignment = defaultFieldAlignment;
  const out = [];

  for (let i = 0; i < rawFields.length; i++) {
    const field = normalizeField(rawFields[i], i, normalizedOptions);
    const alignedOffset = alignMemoryOffset(offset, field.alignment);
    const paddingBefore = alignedOffset - offset;
    const endOffset = alignedOffset + field.byteSize;
    out.push({
      ...field,
      index: i,
      offset: alignedOffset,
      byteOffset: alignedOffset,
      endOffset,
      paddingBefore,
      paddingAfter: 0,
    });
    offset = endOffset;
    maxFieldAlignment = Math.max(maxFieldAlignment, field.alignment);
  }

  const layoutAlignment = finalAlignment ?? Math.max(maxFieldAlignment, positiveInteger(options.structAlignment ?? 1, 'structAlignment'));
  const byteSize = alignMemoryOffset(offset, layoutAlignment) - baseOffset;
  const finalSize = baseOffset + byteSize;
  const tailPadding = finalSize - offset;

  if (out.length > 0 && tailPadding > 0) {
    out[out.length - 1] = { ...out[out.length - 1], paddingAfter: tailPadding };
  }

  return {
    schema: 'particle-realms.memory-field-layout.v1',
    baseOffset,
    byteSize,
    endOffset: finalSize,
    alignment: layoutAlignment,
    maxFieldAlignment,
    fieldCount: out.length,
    payloadBytes: out.reduce((sum, field) => sum + field.byteSize, 0),
    paddingBytes: out.reduce((sum, field) => sum + field.paddingBefore, 0) + tailPadding,
    fields: freezeList(out),
  };
}

export function interleavedVertexLayoutReport(attributes, options = {}) {
  const alignment = positiveInteger(options.attributeAlignment ?? 4, 'attributeAlignment');
  const strideAlignment = positiveInteger(options.strideAlignment ?? 4, 'strideAlignment');
  const layout = memoryFieldLayout(attributes, {
    defaultFieldAlignment: alignment,
    finalAlignment: strideAlignment,
  });
  return {
    schema: 'particle-realms.interleaved-vertex-layout.v1',
    arrayStride: layout.byteSize,
    strideAlignment,
    attributeCount: layout.fieldCount,
    attributes: layout.fields,
    paddingBytes: layout.paddingBytes,
  };
}

export function planarBufferLayoutReport(attributes, elementCount, options = {}) {
  const count = nonnegativeInteger(elementCount, 'elementCount');
  const alignment = positiveInteger(options.alignment ?? STORAGE_ALIGN, 'alignment');
  const fields = normalizeFields(attributes);
  let offset = nonnegativeInteger(options.baseOffset ?? 0, 'baseOffset');
  const planes = [];

  for (let i = 0; i < fields.length; i++) {
    const field = normalizeField(fields[i], i, { defaultFieldAlignment: positiveInteger(options.defaultFieldAlignment ?? 4, 'defaultFieldAlignment') });
    const byteOffset = alignMemoryOffset(offset, field.alignment);
    const rowBytes = field.byteSize;
    const payloadBytes = rowBytes * count;
    const byteSize = alignedMemoryByteSize(payloadBytes, alignment);
    planes.push({
      ...field,
      index: i,
      offset: byteOffset,
      byteOffset,
      elementCount: count,
      payloadBytes,
      byteSize,
      endOffset: byteOffset + byteSize,
      paddingBefore: byteOffset - offset,
      paddingAfter: byteSize - payloadBytes,
    });
    offset = byteOffset + byteSize;
  }

  const totalBytes = alignedMemoryByteSize(offset - (options.baseOffset ?? 0), alignment);
  return {
    schema: 'particle-realms.planar-buffer-layout.v1',
    elementCount: count,
    alignment,
    byteSize: totalBytes,
    planeCount: planes.length,
    planes: freezeList(planes),
  };
}

export function aosElementByteOffset(index, stride, fieldOffset = 0, baseOffset = 0) {
  return nonnegativeInteger(baseOffset, 'baseOffset')
    + nonnegativeInteger(index, 'index') * positiveInteger(stride, 'stride')
    + nonnegativeInteger(fieldOffset, 'fieldOffset');
}

export function soaElementByteOffset(index, elementByteSize, baseOffset = 0) {
  return nonnegativeInteger(baseOffset, 'baseOffset')
    + nonnegativeInteger(index, 'index') * positiveInteger(elementByteSize, 'elementByteSize');
}

export function wgslStructLayoutReport(wgslCode) {
  const layout = parseWGSLStruct(String(wgslCode ?? ''));
  const calculatorByteSize = calcWGSLStructSize(String(wgslCode ?? ''));
  const fields = layout.fieldOrder.map((name, index) => {
    const field = layout.fields[name];
    return Object.freeze({
      index,
      name,
      type: field.type,
      offset: field.offset,
      byteOffset: field.byteOffset,
      byteSize: field.size,
      alignment: field.align,
      components: field.components,
      jsType: field.jsType,
      f32Offset: field.f32Offset,
      u32Offset: field.u32Offset,
      i32Offset: field.i32Offset,
    });
  });

  return {
    schema: 'particle-realms.wgsl-struct-layout.v1',
    name: layout.name,
    byteSize: layout.size,
    alignment: layout.align,
    f32Count: layout.f32Count,
    u32Count: layout.u32Count,
    calculatorByteSize,
    agreesWithSizeCalculator: layout.size === calculatorByteSize,
    fieldCount: fields.length,
    fields: Object.freeze(fields),
    fieldOrder: Object.freeze([...layout.fieldOrder]),
  };
}

export function std140StructLayoutReport(name, fields) {
  const builder = new Std140StructBuilder(String(name ?? 'Std140Struct'));
  for (const field of normalizeFields(fields)) {
    builder.addField(String(field.name), normalizeTypeName(field.type), field.defaultValue ?? null);
  }
  const layout = builder.build();
  const outFields = layout.fields.map((field, index) => ({
    index,
    name: field.name,
    type: field.type,
    offset: field.offset,
    byteOffset: field.offset,
    byteSize: field.size,
    alignment: field.align,
    components: field.components,
    paddingBefore: field.padding,
  }));

  return {
    schema: 'particle-realms.std140-struct-layout.v1',
    name: layout.name,
    byteSize: layout.size,
    alignment: layout.alignment,
    fieldCount: outFields.length,
    fields: freezeList(outFields),
  };
}

export default {
  MEMORY_LAYOUT_ALIGNMENTS,
  memoryLayoutAlignmentForKind,
  alignMemoryOffset,
  memoryPaddingForAlignment,
  isMemoryAligned,
  alignedMemoryByteSize,
  memoryFieldLayout,
  interleavedVertexLayoutReport,
  planarBufferLayoutReport,
  aosElementByteOffset,
  soaElementByteOffset,
  wgslStructLayoutReport,
  std140StructLayoutReport,
};
