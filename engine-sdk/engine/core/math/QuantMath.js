// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

// QuantMath.js - reusable scalar and array quantization primitives.

import {
  packOctNormal,
  unpackOctNormal,
} from './MathPacking.js';

export const QUANT_INT16_MAX = 32767;
export const QUANT_INT8_MAX = 127;
export const QUANT_UNORM16_MAX = 65535;

function clampSignedUnit(value) {
  return Math.max(-1, Math.min(1, value));
}

function clampUnit(value) {
  return Math.max(0, Math.min(1, value));
}

function clampBitDepth(bitDepth, minBits, maxBits, fallback) {
  return Number.isFinite(bitDepth)
    ? Math.max(minBits, Math.min(maxBits, bitDepth | 0))
    : fallback;
}

function signedBitDepthMaxValue(bitDepth) {
  return (2 ** (clampBitDepth(bitDepth, 2, 16, 16) - 1)) - 1;
}

function unsignedBitDepthMaxValue(bitDepth) {
  return (2 ** clampBitDepth(bitDepth, 1, 16, 16)) - 1;
}

function signedArrayForBitDepth(length, bitDepth) {
  return clampBitDepth(bitDepth, 2, 16, 16) <= 8
    ? new Int8Array(length)
    : new Int16Array(length);
}

function unsignedArrayForBitDepth(length, bitDepth) {
  return clampBitDepth(bitDepth, 1, 16, 16) <= 8
    ? new Uint8Array(length)
    : new Uint16Array(length);
}

function normalizeRange(min, max) {
  if (!Number.isFinite(min) || !Number.isFinite(max) || min === max) {
    return { min: 0, max: 0, span: 0, valid: false };
  }
  const lo = Math.min(min, max);
  const hi = Math.max(min, max);
  return { min: lo, max: hi, span: hi - lo, valid: true };
}

function component(value, key, fallback = 0) {
  if (Array.isArray(value) || ArrayBuffer.isView(value)) {
    const index = key === 'r' || key === 'x' ? 0
      : key === 'g' || key === 'y' ? 1
        : key === 'b' || key === 'z' ? 2
          : 3;
    return value[index] ?? fallback;
  }
  return value?.[key] ?? fallback;
}

export function quantizationStep(range, maxValue = QUANT_INT16_MAX) {
  return Math.abs(range) / maxValue;
}

export function quantizationMaxAbsoluteError(range, maxValue = QUANT_INT16_MAX) {
  return quantizationStep(range, maxValue) * 0.5;
}

export function quantizeSignedFloat(value, range, maxValue = QUANT_INT16_MAX) {
  return Math.round(clampSignedUnit(value / range) * maxValue) | 0;
}

export function dequantizeSignedFloat(quantized, range, maxValue = QUANT_INT16_MAX) {
  return (quantized / maxValue) * range;
}

export function quantizeSignedFloatToInt16(value, range) {
  return quantizeSignedFloat(value, range, QUANT_INT16_MAX);
}

export function dequantizeSignedInt16ToFloat(quantized, range) {
  return dequantizeSignedFloat(quantized, range, QUANT_INT16_MAX);
}

export function quantizeSignedFloatToInt8(value, range) {
  return quantizeSignedFloat(value, range, QUANT_INT8_MAX);
}

export function dequantizeSignedInt8ToFloat(quantized, range) {
  return dequantizeSignedFloat(quantized, range, QUANT_INT8_MAX);
}

export function quantizeSignedFloatArrayToInt16(values, range) {
  const quantized = new Int16Array(values.length);
  for (let i = 0; i < values.length; i++) {
    quantized[i] = quantizeSignedFloatToInt16(values[i], range);
  }
  return quantized;
}

export function dequantizeSignedInt16ArrayToFloat32(quantized, range) {
  const values = new Float32Array(quantized.length);
  for (let i = 0; i < quantized.length; i++) {
    values[i] = dequantizeSignedInt16ToFloat(quantized[i], range);
  }
  return values;
}

export function quantizeSignedFloatArrayToInt8(values, range) {
  const quantized = new Int8Array(values.length);
  for (let i = 0; i < values.length; i++) {
    quantized[i] = quantizeSignedFloatToInt8(values[i], range);
  }
  return quantized;
}

export function dequantizeSignedInt8ArrayToFloat32(quantized, range) {
  const values = new Float32Array(quantized.length);
  for (let i = 0; i < quantized.length; i++) {
    values[i] = dequantizeSignedInt8ToFloat(quantized[i], range);
  }
  return values;
}

export function quantizeUnitFloatToUint16(value) {
  return Math.round(clampUnit(value) * QUANT_UNORM16_MAX);
}

export function dequantizeUint16ToUnitFloat(quantized) {
  return quantized / QUANT_UNORM16_MAX;
}

export function quantizeUnitFloatArrayToUint16(values) {
  const quantized = new Uint16Array(values.length);
  for (let i = 0; i < values.length; i++) {
    quantized[i] = quantizeUnitFloatToUint16(values[i]);
  }
  return quantized;
}

export function dequantizeUint16ArrayToFloat32(quantized) {
  const values = new Float32Array(quantized.length);
  for (let i = 0; i < quantized.length; i++) {
    values[i] = dequantizeUint16ToUnitFloat(quantized[i]);
  }
  return values;
}

export function quantizeVec2ToInt16(value, range) {
  return quantizeSignedFloatArrayToInt16(value, range);
}

export function dequantizeVec2FromInt16(quantized, range) {
  return dequantizeSignedInt16ArrayToFloat32(quantized, range);
}

export function quantizeVec3ToInt16(value, range) {
  return quantizeSignedFloatArrayToInt16(value, range);
}

export function dequantizeVec3FromInt16(quantized, range) {
  return dequantizeSignedInt16ArrayToFloat32(quantized, range);
}

export function signedQuantizationMaxValue(bitDepth = 16) {
  return signedBitDepthMaxValue(bitDepth);
}

export function unsignedQuantizationMaxValue(bitDepth = 16) {
  return unsignedBitDepthMaxValue(bitDepth);
}

export function quantizeSignedFloatArray(values, range, bitDepth = 16) {
  const maxValue = signedBitDepthMaxValue(bitDepth);
  const quantized = signedArrayForBitDepth(values.length, bitDepth);
  for (let i = 0; i < values.length; i++) {
    quantized[i] = quantizeSignedFloat(values[i], range, maxValue);
  }
  return quantized;
}

export function dequantizeSignedFloatArray(quantized, range, bitDepth = 16) {
  const maxValue = signedBitDepthMaxValue(bitDepth);
  const values = new Float32Array(quantized.length);
  for (let i = 0; i < quantized.length; i++) {
    values[i] = dequantizeSignedFloat(quantized[i], range, maxValue);
  }
  return values;
}

export function quantizeRange(value, min, max, bitDepth = 16, fallback = 0) {
  const range = normalizeRange(min, max);
  if (!range.valid) {
    return fallback;
  }
  const maxValue = unsignedBitDepthMaxValue(bitDepth);
  const safeValue = Number.isFinite(value) ? value : range.min;
  return Math.round(clampUnit((safeValue - range.min) / range.span) * maxValue);
}

export function dequantizeRange(quantized, min, max, bitDepth = 16, fallback = 0) {
  const range = normalizeRange(min, max);
  if (!range.valid || !Number.isFinite(quantized)) {
    return fallback;
  }
  const maxValue = unsignedBitDepthMaxValue(bitDepth);
  return range.min + (quantized / maxValue) * range.span;
}

export function quantizeRangeArray(values, min, max, bitDepth = 16) {
  const quantized = unsignedArrayForBitDepth(values.length, bitDepth);
  for (let i = 0; i < values.length; i++) {
    quantized[i] = quantizeRange(values[i], min, max, bitDepth, 0);
  }
  return quantized;
}

export function dequantizeRangeArray(quantized, min, max, bitDepth = 16) {
  const values = new Float32Array(quantized.length);
  for (let i = 0; i < quantized.length; i++) {
    values[i] = dequantizeRange(quantized[i], min, max, bitDepth, 0);
  }
  return values;
}

export function quantizeVec2(value, range, bitDepth = 16) {
  return quantizeSignedFloatArray(value, range, bitDepth);
}

export function dequantizeVec2(quantized, range, bitDepth = 16) {
  return dequantizeSignedFloatArray(quantized, range, bitDepth);
}

export function quantizeVec3(value, range, bitDepth = 16) {
  return quantizeSignedFloatArray(value, range, bitDepth);
}

export function dequantizeVec3(quantized, range, bitDepth = 16) {
  return dequantizeSignedFloatArray(quantized, range, bitDepth);
}

export function quantizeColor(color, bitDepth = 8) {
  const maxValue = unsignedBitDepthMaxValue(bitDepth);
  const quantized = unsignedArrayForBitDepth(4, bitDepth);
  quantized[0] = Math.round(clampUnit(component(color, 'r')) * maxValue);
  quantized[1] = Math.round(clampUnit(component(color, 'g')) * maxValue);
  quantized[2] = Math.round(clampUnit(component(color, 'b')) * maxValue);
  quantized[3] = Math.round(clampUnit(component(color, 'a', 1)) * maxValue);
  return quantized;
}

export function dequantizeColor(quantized, bitDepth = 8) {
  const maxValue = unsignedBitDepthMaxValue(bitDepth);
  return new Float32Array([
    (quantized?.[0] ?? 0) / maxValue,
    (quantized?.[1] ?? 0) / maxValue,
    (quantized?.[2] ?? 0) / maxValue,
    (quantized?.[3] ?? maxValue) / maxValue,
  ]);
}

export function quantizeColorRGBA8(color) {
  return quantizeColor(color, 8);
}

export function dequantizeColorRGBA8(quantized) {
  return dequantizeColor(quantized, 8);
}

export function quantizeNormal(normal) {
  return packOctNormal(component(normal, 'x'), component(normal, 'y'), component(normal, 'z', 1));
}

export function dequantizeNormal(packed) {
  return unpackOctNormal(packed);
}

export function deltaQuantize(values, range, bitDepth = 16) {
  const count = values?.length ?? 0;
  const deltas = signedArrayForBitDepth(Math.max(0, count - 1), bitDepth);
  const initial = count > 0 && Number.isFinite(values[0]) ? values[0] : 0;
  let previous = initial;
  const maxValue = signedBitDepthMaxValue(bitDepth);

  for (let i = 1; i < count; i++) {
    const current = Number.isFinite(values[i]) ? values[i] : previous;
    deltas[i - 1] = quantizeSignedFloat(current - previous, range, maxValue);
    previous = current;
  }

  return { initial, deltas, range, bitDepth };
}

export function deltaDequantize(packed) {
  const deltas = packed?.deltas ?? [];
  const range = packed?.range ?? 1;
  const bitDepth = packed?.bitDepth ?? 16;
  const maxValue = signedBitDepthMaxValue(bitDepth);
  const values = new Float32Array(deltas.length + 1);
  values[0] = Number.isFinite(packed?.initial) ? packed.initial : 0;

  for (let i = 0; i < deltas.length; i++) {
    values[i + 1] = values[i] + dequantizeSignedFloat(deltas[i], range, maxValue);
  }

  return values;
}

export const dequantizeDelta = deltaDequantize;

export function quantizationErrorReport(source, decoded, tolerance = 0) {
  const count = Math.min(source?.length ?? 0, decoded?.length ?? 0);
  let maxAbsError = 0;
  let sumAbsError = 0;
  let sumSquaredError = 0;
  let failures = 0;

  for (let i = 0; i < count; i++) {
    const error = Math.abs((decoded[i] ?? 0) - (source[i] ?? 0));
    maxAbsError = Math.max(maxAbsError, error);
    sumAbsError += error;
    sumSquaredError += error * error;
    if (error > tolerance) failures++;
  }

  return {
    count,
    tolerance,
    maxAbsError,
    meanAbsError: count > 0 ? sumAbsError / count : 0,
    rmsError: count > 0 ? Math.sqrt(sumSquaredError / count) : 0,
    failures,
    withinTolerance: failures === 0,
  };
}

export function quaternionOrientationErrorReport(source, decoded, toleranceRadians = 0) {
  const count = Math.floor(Math.min(source?.length ?? 0, decoded?.length ?? 0) / 4);
  let maxAngleError = 0;
  let sumAngleError = 0;
  let sumSquaredAngleError = 0;
  let failures = 0;

  for (let frame = 0; frame < count; frame++) {
    const offset = frame * 4;
    const sx = source[offset] ?? 0;
    const sy = source[offset + 1] ?? 0;
    const sz = source[offset + 2] ?? 0;
    const sw = source[offset + 3] ?? 1;
    const dx = decoded[offset] ?? 0;
    const dy = decoded[offset + 1] ?? 0;
    const dz = decoded[offset + 2] ?? 0;
    const dw = decoded[offset + 3] ?? 1;
    const sourceLength = Math.hypot(sx, sy, sz, sw);
    const decodedLength = Math.hypot(dx, dy, dz, dw);
    const dot = sourceLength > 0 && decodedLength > 0
      ? Math.abs((sx * dx + sy * dy + sz * dz + sw * dw) / (sourceLength * decodedLength))
      : 0;
    const clampedDot = Math.max(0, Math.min(1, Number.isFinite(dot) ? dot : 0));
    const angleError = 2 * Math.acos(clampedDot);

    maxAngleError = Math.max(maxAngleError, angleError);
    sumAngleError += angleError;
    sumSquaredAngleError += angleError * angleError;
    if (angleError > toleranceRadians) failures++;
  }

  return {
    count,
    toleranceRadians,
    maxAngleError,
    meanAngleError: count > 0 ? sumAngleError / count : 0,
    rmsAngleError: count > 0 ? Math.sqrt(sumSquaredAngleError / count) : 0,
    failures,
    withinTolerance: failures === 0,
  };
}

export function adaptiveQuantize(values, options = {}) {
  const bitDepths = (options.bitDepths ?? [8, 12, 16]).slice().sort((a, b) => a - b);
  const tolerance = Number.isFinite(options.tolerance) ? Math.max(0, options.tolerance) : 0;
  const range = Number.isFinite(options.range)
    ? Math.abs(options.range)
    : Array.from(values ?? []).reduce((maxAbs, value) => (
      Number.isFinite(value) ? Math.max(maxAbs, Math.abs(value)) : maxAbs
    ), 0);

  let bitDepth = bitDepths[bitDepths.length - 1] ?? 16;
  for (const candidate of bitDepths) {
    if (quantizationMaxAbsoluteError(range, signedBitDepthMaxValue(candidate)) <= tolerance) {
      bitDepth = candidate;
      break;
    }
  }

  const quantized = quantizeSignedFloatArray(values ?? [], range, bitDepth);
  const decoded = dequantizeSignedFloatArray(quantized, range, bitDepth);
  const report = quantizationErrorReport(values ?? [], decoded, tolerance);

  return {
    values: quantized,
    range,
    bitDepth,
    signed: true,
    step: quantizationStep(range, signedBitDepthMaxValue(bitDepth)),
    maxAbsoluteError: quantizationMaxAbsoluteError(range, signedBitDepthMaxValue(bitDepth)),
    report,
  };
}

export function adaptiveDequantize(packed) {
  return dequantizeSignedFloatArray(packed?.values ?? [], packed?.range ?? 1, packed?.bitDepth ?? 16);
}

export default {
  QUANT_INT16_MAX,
  QUANT_INT8_MAX,
  QUANT_UNORM16_MAX,
  quantizationStep,
  quantizationMaxAbsoluteError,
  quantizeSignedFloat,
  dequantizeSignedFloat,
  quantizeSignedFloatToInt16,
  dequantizeSignedInt16ToFloat,
  quantizeSignedFloatToInt8,
  dequantizeSignedInt8ToFloat,
  quantizeSignedFloatArrayToInt16,
  dequantizeSignedInt16ArrayToFloat32,
  quantizeSignedFloatArrayToInt8,
  dequantizeSignedInt8ArrayToFloat32,
  quantizeUnitFloatToUint16,
  dequantizeUint16ToUnitFloat,
  quantizeUnitFloatArrayToUint16,
  dequantizeUint16ArrayToFloat32,
  quantizeVec2ToInt16,
  dequantizeVec2FromInt16,
  quantizeVec3ToInt16,
  dequantizeVec3FromInt16,
  signedQuantizationMaxValue,
  unsignedQuantizationMaxValue,
  quantizeSignedFloatArray,
  dequantizeSignedFloatArray,
  quantizeRange,
  dequantizeRange,
  quantizeRangeArray,
  dequantizeRangeArray,
  quantizeVec2,
  dequantizeVec2,
  quantizeVec3,
  dequantizeVec3,
  quantizeColor,
  dequantizeColor,
  quantizeColorRGBA8,
  dequantizeColorRGBA8,
  quantizeNormal,
  dequantizeNormal,
  deltaQuantize,
  deltaDequantize,
  dequantizeDelta,
  adaptiveQuantize,
  adaptiveDequantize,
  quantizationErrorReport,
  quaternionOrientationErrorReport,
};
