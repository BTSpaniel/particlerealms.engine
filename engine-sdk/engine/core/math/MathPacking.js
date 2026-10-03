// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

// MathPacking.js - GPU data packing utilities
// Half-float, SNORM/UNORM, RGB9E5, R11G11B10F
// Consolidates: World3DPreviewRenderer._floatToHalf, MeshCompression.quantizeUVs

import {
  pack2x16 as packBits2x16,
  pack4x8 as packBits4x8,
  unpack2x16 as unpackBits2x16,
  unpack4x8 as unpackBits4x8,
} from './MathBits.js';

// ============================================================================
// HALF-FLOAT (IEEE 754 binary16)
// ============================================================================

const _f32 = new Float32Array(1);
const _u32 = new Uint32Array(_f32.buffer);

const QUAT_SMALLEST_THREE_SCALE = 32767 * Math.SQRT2;
export const TRANSFORM_PACKED_TRS_LENGTH = 10;
export const DEFAULT_TRANSFORM_PACKING_SCALES = Object.freeze({
  position: 1000,
  rotation: 10000,
  scale: 100,
});
export const PARTICLE_STATE_PACKED_VEC4_LENGTH = 4;
export const DEFAULT_PARTICLE_PACKING_RANGES = Object.freeze({
  position: 1000,
  velocity: 100,
  age: 100,
  lifetime: 100,
});
export const VOXEL_MATERIAL_UNIFORM_FLOATS = 12;
export const DEFAULT_VOXEL_MATERIAL_UNIFORMS = Object.freeze({
  baseColor: Object.freeze([1, 1, 1, 1]),
  emissive: Object.freeze([0, 0, 0]),
  metallic: 0,
  roughness: 1,
  triplanarScale: 0.1,
  triplanarSharpness: 4,
});

function clampByte(value) {
  return Number.isFinite(value) ? Math.max(0, Math.min(255, Math.round(value))) : 0;
}

function finiteOrDefault(value, fallback) {
  return Number.isFinite(value) ? value : fallback;
}

function finiteScalarOrDefault(value, fallback) {
  if (value == null) return fallback;
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function scaledInt(value, scale, fallback) {
  return Math.round(finiteOrDefault(value, fallback) * scale);
}

function unscaledInt(value, scale, fallback = 0) {
  return finiteOrDefault(value, Math.round(fallback * scale)) / scale;
}

function positiveRangeOrDefault(range, fallback) {
  return Number.isFinite(range) && range > 0 ? range : fallback;
}

function unsignedBitDepthMaxValue(bitDepth, fallback = 16) {
  const safeBitDepth = Number.isFinite(bitDepth)
    ? Math.max(1, Math.min(16, bitDepth | 0))
    : fallback;
  return (2 ** safeBitDepth) - 1;
}

function signedBitDepthMaxValue(bitDepth, fallback = 16) {
  const safeBitDepth = Number.isFinite(bitDepth)
    ? Math.max(2, Math.min(16, bitDepth | 0))
    : fallback;
  return (2 ** (safeBitDepth - 1)) - 1;
}

function resolveTransformPackingScales(options = {}) {
  const positionScale = Number.isFinite(options.positionScale) && options.positionScale > 0
    ? options.positionScale
    : DEFAULT_TRANSFORM_PACKING_SCALES.position;
  const rotationScale = Number.isFinite(options.rotationScale) && options.rotationScale > 0
    ? options.rotationScale
    : DEFAULT_TRANSFORM_PACKING_SCALES.rotation;
  const scaleScale = Number.isFinite(options.scaleScale) && options.scaleScale > 0
    ? options.scaleScale
    : DEFAULT_TRANSFORM_PACKING_SCALES.scale;
  return { positionScale, rotationScale, scaleScale };
}

function resolveParticlePackingRanges(options = {}) {
  return {
    positionRange: positiveRangeOrDefault(options.positionRange, DEFAULT_PARTICLE_PACKING_RANGES.position),
    velocityRange: positiveRangeOrDefault(options.velocityRange, DEFAULT_PARTICLE_PACKING_RANGES.velocity),
    ageRange: positiveRangeOrDefault(options.ageRange, DEFAULT_PARTICLE_PACKING_RANGES.age),
    lifetimeRange: positiveRangeOrDefault(options.lifetimeRange, DEFAULT_PARTICLE_PACKING_RANGES.lifetime),
  };
}

function isOptionsObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value) && !ArrayBuffer.isView(value);
}

function finiteComponentArray(value, fallback, length) {
  const source = Array.isArray(value) || ArrayBuffer.isView(value) ? value : fallback;
  const out = new Array(length);
  for (let i = 0; i < length; i++) {
    out[i] = finiteScalarOrDefault(source[i], fallback[i] ?? 0);
  }
  return out;
}

function particlePositionArgs(x, y, z, age) {
  if (Array.isArray(x) || ArrayBuffer.isView(x)) {
    return { x: x[0], y: x[1], z: x[2], age: age ?? y ?? x[3] };
  }

  if (typeof x === 'object' && x !== null) {
    const position = x.position ?? x;
    return {
      x: position[0] ?? x.x,
      y: position[1] ?? x.y,
      z: position[2] ?? x.z,
      age: x.age ?? x.w,
    };
  }

  return { x, y, z, age };
}

function particleVelocityArgs(vx, vy, vz, lifetime) {
  if (Array.isArray(vx) || ArrayBuffer.isView(vx)) {
    return { vx: vx[0], vy: vx[1], vz: vx[2], lifetime: lifetime ?? vy ?? vx[3] };
  }

  if (typeof vx === 'object' && vx !== null) {
    const velocity = vx.velocity ?? vx;
    return {
      vx: velocity[0] ?? vx.vx,
      vy: velocity[1] ?? vx.vy,
      vz: velocity[2] ?? vx.vz,
      lifetime: vx.lifetime ?? vx.w,
    };
  }

  return { vx, vy, vz, lifetime };
}

function normalizeQuatInput(x, y, z, w) {
  if (Array.isArray(x) || ArrayBuffer.isView(x)) {
    [x, y, z, w] = x;
  }

  if (![x, y, z, w].every(Number.isFinite)) {
    return [0, 0, 0, 1];
  }

  const len = Math.hypot(x, y, z, w);
  return len > 0 ? [x / len, y / len, z / len, w / len] : [0, 0, 0, 1];
}

function quantizeQuatComponent(value) {
  return Math.round(Math.max(-1, Math.min(1, value * Math.SQRT2)) * 32767);
}

function dequantizeQuatComponent(value) {
  return value / QUAT_SMALLEST_THREE_SCALE;
}

export function floatToHalf(val) {
  _f32[0] = val;
  const x = _u32[0];
  const sign = (x >>> 16) & 0x8000;
  const exponent = (x >>> 23) & 0xff;
  const mantissa = x & 0x7fffff;

  if (exponent === 0xff) {
    return sign | (mantissa ? 0x7e00 : 0x7c00);
  }

  const halfExponent = exponent - 127 + 15;
  if (halfExponent >= 0x1f) {
    return sign | 0x7c00;
  }

  if (halfExponent <= 0) {
    if (halfExponent < -10) {
      return sign;
    }

    const shiftedMantissa = mantissa | 0x800000;
    const shift = 14 - halfExponent;
    const rounded = (shiftedMantissa >> shift) + ((shiftedMantissa >> (shift - 1)) & 1);
    return sign | rounded;
  }

  const rounded = sign | (halfExponent << 10) | (mantissa >> 13);
  return (rounded + ((mantissa >> 12) & 1)) & 0xffff;
}

export function halfToFloat(h) {
  const bits = h & 0xffff;
  const sign = (bits & 0x8000) ? -1 : 1;
  const exponent = (bits >>> 10) & 0x1f;
  const mantissa = bits & 0x03ff;

  if (exponent === 0) {
    return sign * (mantissa === 0 ? 0 : (mantissa / 1024) * 2 ** -14);
  }

  if (exponent === 0x1f) {
    return mantissa ? NaN : sign * Infinity;
  }

  return sign * (1 + mantissa / 1024) * 2 ** (exponent - 15);
}

export function floatArrayToHalf(arr) {
  const out = new Uint16Array(arr.length);
  for (let i = 0; i < arr.length; i++) out[i] = floatToHalf(arr[i]);
  return out;
}

export function halfArrayToFloat(arr) {
  const out = new Float32Array(arr.length);
  for (let i = 0; i < arr.length; i++) out[i] = halfToFloat(arr[i]);
  return out;
}

// ============================================================================
// UNORM (unsigned normalized: 0.0–1.0 ↔ 0–max)
// ============================================================================

export const packUNORM8 = (f) => Math.round(Math.max(0, Math.min(1, f)) * 255) & 0xff;
export const unpackUNORM8 = (u) => (u & 0xff) / 255;

export const packUNORM16 = (f) => Math.round(Math.max(0, Math.min(1, f)) * 65535) & 0xffff;
export const unpackUNORM16 = (u) => (u & 0xffff) / 65535;

export function packUNORM8Array(arr) {
  const out = new Uint8Array(arr.length);
  for (let i = 0; i < arr.length; i++) out[i] = packUNORM8(arr[i]);
  return out;
}

export function unpackUNORM8Array(arr) {
  const out = new Float32Array(arr.length);
  for (let i = 0; i < arr.length; i++) out[i] = unpackUNORM8(arr[i]);
  return out;
}

export function packUNORM16Array(arr) {
  const out = new Uint16Array(arr.length);
  for (let i = 0; i < arr.length; i++) out[i] = packUNORM16(arr[i]);
  return out;
}

export function unpackUNORM16Array(arr) {
  const out = new Float32Array(arr.length);
  for (let i = 0; i < arr.length; i++) out[i] = unpackUNORM16(arr[i]);
  return out;
}

// Signed range packed into unsigned normalized bits: [-range, range] <-> [0, 2^bits - 1].
export function packSignedRangeUNORMBits(value, range, bitDepth = 16, fallback = 0) {
  const maxValue = unsignedBitDepthMaxValue(bitDepth);
  const safeRange = positiveRangeOrDefault(range, 1);
  const safeValue = Math.max(-safeRange, Math.min(safeRange, finiteOrDefault(value, fallback)));
  return Math.round(((safeValue + safeRange) / (2 * safeRange)) * maxValue);
}

export function unpackSignedRangeUNORMBits(packed, range, bitDepth = 16, fallback = 0) {
  if (!Number.isFinite(packed)) {
    return fallback;
  }

  const maxValue = unsignedBitDepthMaxValue(bitDepth);
  const safeRange = positiveRangeOrDefault(range, 1);
  return (packed / maxValue) * (2 * safeRange) - safeRange;
}

// Signed range packed into UNORM16: [-range, range] <-> [0, 65535].
export function packSignedRangeUNORM16(value, range, fallback = 0) {
  return packSignedRangeUNORMBits(value, range, 16, fallback);
}

export function unpackSignedRangeUNORM16(packed, range, fallback = 0) {
  if (!Number.isFinite(packed)) {
    return fallback;
  }

  const safeRange = positiveRangeOrDefault(range, 1);
  return unpackUNORM16(packed) * (2 * safeRange) - safeRange;
}

// ============================================================================
// SNORM (signed normalized: -1.0–1.0 ↔ -128–127 / -32768–32767)
// ============================================================================

export const packSNORM8 = (f) => {
  const v = Math.round(Math.max(-1, Math.min(1, f)) * 127);
  return v < 0 ? v + 256 : v;
};
export const unpackSNORM8 = (s) => {
  const v = (s & 0xff);
  return (v > 127 ? v - 256 : v) / 127;
};

export const packSNORM16 = (f) => {
  const v = Math.round(Math.max(-1, Math.min(1, f)) * 32767);
  return v < 0 ? v + 65536 : v;
};
export const unpackSNORM16 = (s) => {
  const v = (s & 0xffff);
  return (v > 32767 ? v - 65536 : v) / 32767;
};

// Signed range packed into signed normalized integer bits: [-range, range] <-> [-max, max].
export function packSignedRangeSNORMBits(value, range, bitDepth = 16, fallback = 0) {
  const maxValue = signedBitDepthMaxValue(bitDepth);
  const safeRange = positiveRangeOrDefault(range, 1);
  const safeValue = Math.max(-safeRange, Math.min(safeRange, finiteOrDefault(value, fallback)));
  return Math.round((safeValue / safeRange) * maxValue);
}

export function unpackSignedRangeSNORMBits(packed, range, bitDepth = 16, fallback = 0) {
  if (!Number.isFinite(packed)) {
    return fallback;
  }

  const maxValue = signedBitDepthMaxValue(bitDepth);
  const safeRange = positiveRangeOrDefault(range, 1);
  return (packed / maxValue) * safeRange;
}

// Signed range packed into SNORM16: [-range, range] <-> signed Int16 storage.
export function packSignedRangeSNORM16(value, range, fallback = 0) {
  const safeRange = positiveRangeOrDefault(range, 1);
  const safeValue = Math.max(-safeRange, Math.min(safeRange, finiteOrDefault(value, fallback)));
  return packSNORM16(safeValue / safeRange);
}

export function unpackSignedRangeSNORM16(packed, range, fallback = 0) {
  if (!Number.isFinite(packed)) {
    return fallback;
  }

  const safeRange = positiveRangeOrDefault(range, 1);
  return unpackSNORM16(packed) * safeRange;
}

// ============================================================================
// VECTOR LANE PACKING
// ============================================================================

export function packUint8x4(x, y, z, w) {
  return packBits4x8(clampByte(x), clampByte(y), clampByte(z), clampByte(w)) >>> 0;
}

export function unpackUint8x4(packed) {
  return unpackBits4x8(packed >>> 0);
}

export function packUNORM8x4(x, y, z, w) {
  return packUint8x4(packUNORM8(x), packUNORM8(y), packUNORM8(z), packUNORM8(w));
}

export function unpackUNORM8x4(packed) {
  return unpackUint8x4(packed).map(unpackUNORM8);
}

export function packSNORM8x4(x, y, z, w) {
  return packUint8x4(packSNORM8(x), packSNORM8(y), packSNORM8(z), packSNORM8(w));
}

export function unpackSNORM8x4(packed) {
  return unpackUint8x4(packed).map(unpackSNORM8);
}

export function packUNORM16x2(x, y) {
  return packBits2x16(packUNORM16(x), packUNORM16(y)) >>> 0;
}

export function unpackUNORM16x2(packed) {
  return unpackBits2x16(packed >>> 0).map(unpackUNORM16);
}

export function packSNORM16x2(x, y) {
  return packBits2x16(packSNORM16(x), packSNORM16(y)) >>> 0;
}

export function unpackSNORM16x2(packed) {
  return unpackBits2x16(packed >>> 0).map(unpackSNORM16);
}

export const packVec2UNORM16 = packUNORM16x2;
export const unpackVec2UNORM16 = unpackUNORM16x2;
export const packVec2SNORM16 = packSNORM16x2;
export const unpackVec2SNORM16 = unpackSNORM16x2;

// ============================================================================
// TRANSFORM SCALAR PACKING
// ============================================================================

export function packTransformTRS10(transform = {}, options = {}) {
  const { positionScale, rotationScale, scaleScale } = resolveTransformPackingScales(options);
  const position = transform?.position ?? transform?.translation ?? [0, 0, 0];
  const rotation = transform?.rotation ?? [0, 0, 0, 1];
  const scale = transform?.scale ?? [1, 1, 1];
  const out = options.out ?? new Array(TRANSFORM_PACKED_TRS_LENGTH);

  out[0] = scaledInt(position[0], positionScale, 0);
  out[1] = scaledInt(position[1], positionScale, 0);
  out[2] = scaledInt(position[2], positionScale, 0);
  out[3] = scaledInt(rotation[0], rotationScale, 0);
  out[4] = scaledInt(rotation[1], rotationScale, 0);
  out[5] = scaledInt(rotation[2], rotationScale, 0);
  out[6] = scaledInt(rotation[3], rotationScale, 1);
  out[7] = scaledInt(scale[0], scaleScale, 1);
  out[8] = scaledInt(scale[1], scaleScale, 1);
  out[9] = scaledInt(scale[2], scaleScale, 1);
  return out;
}

export function unpackTransformTRS10(packed, options = {}) {
  const { positionScale, rotationScale, scaleScale } = resolveTransformPackingScales(options);
  const data = packed ?? [];
  return {
    position: [
      unscaledInt(data[0], positionScale, 0),
      unscaledInt(data[1], positionScale, 0),
      unscaledInt(data[2], positionScale, 0),
    ],
    rotation: [
      unscaledInt(data[3], rotationScale, 0),
      unscaledInt(data[4], rotationScale, 0),
      unscaledInt(data[5], rotationScale, 0),
      unscaledInt(data[6], rotationScale, 1),
    ],
    scale: [
      unscaledInt(data[7], scaleScale, 1),
      unscaledInt(data[8], scaleScale, 1),
      unscaledInt(data[9], scaleScale, 1),
    ],
  };
}

export const packTransform = packTransformTRS10;
export const unpackTransform = unpackTransformTRS10;

// ============================================================================
// PARTICLE STATE PACKING
// ============================================================================

export function packParticlePositionAge(x, y, z, age, options = {}) {
  if ((Array.isArray(x) || ArrayBuffer.isView(x) || isOptionsObject(x)) && isOptionsObject(y)) {
    options = y;
    y = undefined;
    z = undefined;
    age = undefined;
  } else if (isOptionsObject(age)) {
    options = age;
    age = undefined;
  }

  const args = particlePositionArgs(x, y, z, age);
  const { positionRange, ageRange } = resolveParticlePackingRanges(options);
  const out = options.out ?? new Uint16Array(PARTICLE_STATE_PACKED_VEC4_LENGTH);
  out[0] = packSignedRangeUNORM16(args.x, positionRange, 0);
  out[1] = packSignedRangeUNORM16(args.y, positionRange, 0);
  out[2] = packSignedRangeUNORM16(args.z, positionRange, 0);
  out[3] = packSignedRangeUNORM16(args.age, ageRange, 0);
  return out;
}

export function unpackParticlePositionAge(packed, options = {}) {
  const { positionRange, ageRange } = resolveParticlePackingRanges(options);
  const data = packed ?? [];
  return {
    x: unpackSignedRangeUNORM16(data[0], positionRange, 0),
    y: unpackSignedRangeUNORM16(data[1], positionRange, 0),
    z: unpackSignedRangeUNORM16(data[2], positionRange, 0),
    age: unpackSignedRangeUNORM16(data[3], ageRange, 0),
  };
}

export function packParticleVelocityLifetime(vx, vy, vz, lifetime, options = {}) {
  if ((Array.isArray(vx) || ArrayBuffer.isView(vx) || isOptionsObject(vx)) && isOptionsObject(vy)) {
    options = vy;
    vy = undefined;
    vz = undefined;
    lifetime = undefined;
  } else if (isOptionsObject(lifetime)) {
    options = lifetime;
    lifetime = undefined;
  }

  const args = particleVelocityArgs(vx, vy, vz, lifetime);
  const { velocityRange, lifetimeRange } = resolveParticlePackingRanges(options);
  const out = options.out ?? new Uint16Array(PARTICLE_STATE_PACKED_VEC4_LENGTH);
  out[0] = packSignedRangeUNORM16(args.vx, velocityRange, 0);
  out[1] = packSignedRangeUNORM16(args.vy, velocityRange, 0);
  out[2] = packSignedRangeUNORM16(args.vz, velocityRange, 0);
  out[3] = packSignedRangeUNORM16(args.lifetime, lifetimeRange, 0);
  return out;
}

export function unpackParticleVelocityLifetime(packed, options = {}) {
  const { velocityRange, lifetimeRange } = resolveParticlePackingRanges(options);
  const data = packed ?? [];
  return {
    vx: unpackSignedRangeUNORM16(data[0], velocityRange, 0),
    vy: unpackSignedRangeUNORM16(data[1], velocityRange, 0),
    vz: unpackSignedRangeUNORM16(data[2], velocityRange, 0),
    lifetime: unpackSignedRangeUNORM16(data[3], lifetimeRange, 0),
  };
}

export const packParticlePosition = packParticlePositionAge;
export const unpackParticlePosition = unpackParticlePositionAge;
export const packParticleVelocity = packParticleVelocityLifetime;
export const unpackParticleVelocity = unpackParticleVelocityLifetime;

// ============================================================================
// MATERIAL PARAMETER PACKING
// ============================================================================

export function packORM8(occlusion = 1, roughness = 1, metallic = 0, alpha = 1) {
  if (typeof occlusion === 'object' && occlusion !== null) {
    ({ occlusion = 1, roughness = 1, metallic = 0, alpha = 1 } = occlusion);
  }
  return packUNORM8x4(occlusion, roughness, metallic, alpha);
}

export function unpackORM8(packed) {
  const [occlusion, roughness, metallic, alpha] = unpackUNORM8x4(packed);
  return { occlusion, roughness, metallic, alpha };
}

export function packPBRMaterialParams8(metallic = 0, roughness = 1, normalScale = 1, alphaCutoff = 0) {
  if (typeof metallic === 'object' && metallic !== null) {
    ({ metallic = 0, roughness = 1, normalScale = 1, alphaCutoff = 0 } = metallic);
  }
  return packUNORM8x4(metallic, roughness, normalScale, alphaCutoff);
}

export function unpackPBRMaterialParams8(packed) {
  const [metallic, roughness, normalScale, alphaCutoff] = unpackUNORM8x4(packed);
  return { metallic, roughness, normalScale, alphaCutoff };
}

export function normalizeVoxelMaterialUniforms(params = {}) {
  const src = isOptionsObject(params) ? params : {};
  return {
    baseColor: finiteComponentArray(
      src.baseColor,
      DEFAULT_VOXEL_MATERIAL_UNIFORMS.baseColor,
      4
    ),
    emissive: finiteComponentArray(
      src.emissive,
      DEFAULT_VOXEL_MATERIAL_UNIFORMS.emissive,
      3
    ),
    metallic: finiteScalarOrDefault(
      src.metallic,
      DEFAULT_VOXEL_MATERIAL_UNIFORMS.metallic
    ),
    roughness: finiteScalarOrDefault(
      src.roughness,
      DEFAULT_VOXEL_MATERIAL_UNIFORMS.roughness
    ),
    triplanarScale: finiteScalarOrDefault(
      src.triplanarScale,
      DEFAULT_VOXEL_MATERIAL_UNIFORMS.triplanarScale
    ),
    triplanarSharpness: finiteScalarOrDefault(
      src.triplanarSharpness,
      DEFAULT_VOXEL_MATERIAL_UNIFORMS.triplanarSharpness
    ),
  };
}

export function packVoxelMaterialUniforms(params = {}, out = new Float32Array(VOXEL_MATERIAL_UNIFORM_FLOATS)) {
  if (!out || out.length < VOXEL_MATERIAL_UNIFORM_FLOATS) {
    throw new Error(`packVoxelMaterialUniforms: output must have at least ${VOXEL_MATERIAL_UNIFORM_FLOATS} floats`);
  }

  const uniforms = normalizeVoxelMaterialUniforms(params);
  out[0] = uniforms.baseColor[0];
  out[1] = uniforms.baseColor[1];
  out[2] = uniforms.baseColor[2];
  out[3] = uniforms.baseColor[3];
  out[4] = uniforms.emissive[0];
  out[5] = uniforms.emissive[1];
  out[6] = uniforms.emissive[2];
  out[7] = uniforms.metallic;
  out[8] = uniforms.roughness;
  out[9] = uniforms.triplanarScale;
  out[10] = uniforms.triplanarSharpness;
  out[11] = 0;
  return out;
}

export const packMaterialORM8 = packORM8;
export const unpackMaterialORM8 = unpackORM8;
export const packMaterialParams8 = packPBRMaterialParams8;
export const unpackMaterialParams8 = unpackPBRMaterialParams8;

// ============================================================================
// RGB9E5 (shared exponent, HDR, 32-bit)
// ============================================================================

export function packRGB9E5(r, g, b) {
  const maxVal = Math.max(r, g, b);
  if (maxVal < 1e-10) return 0;
  const sharedExp = Math.max(-15, Math.floor(Math.log2(maxVal))) + 16;
  const scale = Math.pow(2, -sharedExp + 24);
  const ri = Math.min(511, Math.round(r * scale)) & 0x1ff;
  const gi = Math.min(511, Math.round(g * scale)) & 0x1ff;
  const bi = Math.min(511, Math.round(b * scale)) & 0x1ff;
  const ei = (sharedExp & 0x1f);
  return ri | (gi << 9) | (bi << 18) | (ei << 27);
}

export function unpackRGB9E5(v) {
  const ri = v & 0x1ff;
  const gi = (v >> 9) & 0x1ff;
  const bi = (v >> 18) & 0x1ff;
  const ei = (v >> 27) & 0x1f;
  const scale = Math.pow(2, ei - 24);
  return [ri * scale, gi * scale, bi * scale];
}

// ============================================================================
// R11G11B10F (unsigned float, 32-bit, no alpha)
// ============================================================================

function packFloat11(f) {
  _f32[0] = Math.max(0, f);
  const x = _u32[0];
  const e = ((x >> 23) & 0xff) - 112;
  if (e <= 0) return 0;
  if (e >= 31) return 0x7c0;
  const m = (x >> 17) & 0x3f;
  return (e << 6) | m;
}

function unpackFloat11(v) {
  const e = (v >> 6) & 0x1f;
  const m = v & 0x3f;
  if (e === 0) return 0;
  if (e === 31) return 65504;
  _u32[0] = ((e + 112) << 23) | (m << 17);
  return _f32[0];
}

function packFloat10(f) {
  _f32[0] = Math.max(0, f);
  const x = _u32[0];
  const e = ((x >> 23) & 0xff) - 112;
  if (e <= 0) return 0;
  if (e >= 31) return 0x3e0;
  const m = (x >> 18) & 0x1f;
  return (e << 5) | m;
}

function unpackFloat10(v) {
  const e = (v >> 5) & 0x1f;
  const m = v & 0x1f;
  if (e === 0) return 0;
  if (e === 31) return 65504;
  _u32[0] = ((e + 112) << 23) | (m << 18);
  return _f32[0];
}

export function packR11G11B10F(r, g, b) {
  return packFloat11(r) | (packFloat11(g) << 11) | (packFloat10(b) << 22);
}

export function unpackR11G11B10F(v) {
  return [unpackFloat11(v & 0x7ff), unpackFloat11((v >> 11) & 0x7ff), unpackFloat10((v >> 22) & 0x3ff)];
}

// ============================================================================
// OCTAHEDRAL NORMAL PACKING (2 × SNORM16 → uint32)
// ============================================================================

export function packOctNormal(nx, ny, nz) {
  const l1 = Math.abs(nx) + Math.abs(ny) + Math.abs(nz);
  if (!Number.isFinite(l1) || l1 <= 0) {
    return 0;
  }
  const invL1 = 1 / l1;
  let ox = nx * invL1;
  let oy = ny * invL1;
  if (nz < 0) {
    const tx = ox, ty = oy;
    ox = (1 - Math.abs(ty)) * (tx >= 0 ? 1 : -1);
    oy = (1 - Math.abs(tx)) * (ty >= 0 ? 1 : -1);
  }
  const px = packSNORM16(ox);
  const py = packSNORM16(oy);
  return px | (py << 16);
}

export function unpackOctNormal(packed) {
  const ox = unpackSNORM16(packed & 0xffff);
  const oy = unpackSNORM16((packed >> 16) & 0xffff);
  let nz = 1 - Math.abs(ox) - Math.abs(oy);
  let nx = ox, ny = oy;
  if (nz < 0) {
    nx = (1 - Math.abs(oy)) * (ox >= 0 ? 1 : -1);
    ny = (1 - Math.abs(ox)) * (oy >= 0 ? 1 : -1);
  }
  const len = Math.sqrt(nx * nx + ny * ny + nz * nz);
  return len > 0 ? [nx / len, ny / len, nz / len] : [0, 0, 1];
}

// ============================================================================
// QUATERNION PACKING (SMALLEST-THREE, 3 × INT16 + INDEX)
// ============================================================================

export function packQuatSmallestThree(x, y, z, w) {
  const q = normalizeQuatInput(x, y, z, w);
  let largestIndex = 0;
  let largestAbs = Math.abs(q[0]);

  for (let i = 1; i < 4; i++) {
    const componentAbs = Math.abs(q[i]);
    if (componentAbs > largestAbs) {
      largestAbs = componentAbs;
      largestIndex = i;
    }
  }

  const sign = q[largestIndex] < 0 ? -1 : 1;
  const values = new Int16Array(3);
  let outIndex = 0;
  for (let i = 0; i < 4; i++) {
    if (i !== largestIndex) {
      values[outIndex++] = quantizeQuatComponent(q[i] * sign);
    }
  }

  return { largestIndex, values };
}

export function unpackQuatSmallestThree(packed) {
  const largestIndex = packed?.largestIndex | 0;
  const values = packed?.values;
  if (largestIndex < 0 || largestIndex > 3 || !values || values.length < 3) {
    return [0, 0, 0, 1];
  }

  const q = [0, 0, 0, 0];
  let inIndex = 0;
  let sumSq = 0;
  for (let i = 0; i < 4; i++) {
    if (i !== largestIndex) {
      const component = dequantizeQuatComponent(values[inIndex++]);
      q[i] = component;
      sumSq += component * component;
    }
  }

  q[largestIndex] = Math.sqrt(Math.max(0, 1 - sumSq));
  return normalizeQuatInput(q);
}

export const packQuaternionSmallestThree = packQuatSmallestThree;
export const unpackQuaternionSmallestThree = unpackQuatSmallestThree;
export const packQuat = packQuatSmallestThree;
export const unpackQuat = unpackQuatSmallestThree;
