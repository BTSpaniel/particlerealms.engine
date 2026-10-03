// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

// ChecksumMath.js - reusable byte checksums, non-crypto hashes, rolling hashes, and digest wrappers.

import {
  bufferByteView,
  encodeUtf8,
} from './BufferMath.js';

const CRC32_POLYNOMIAL = 0xedb88320;
const ADLER32_BASE = 65521;
export const FNV1A32_OFFSET_BASIS = 0x811c9dc5;
const FNV1A32_PRIME = 0x01000193;
const FNV1A64_OFFSET_BASIS = 0xcbf29ce484222325n;
const FNV1A64_PRIME = 0x100000001b3n;
const UINT64_MASK = 0xffffffffffffffffn;
const XXHASH32_PRIME1 = 0x9e3779b1;
const XXHASH32_PRIME2 = 0x85ebca77;
const XXHASH32_PRIME3 = 0xc2b2ae3d;
const XXHASH32_PRIME4 = 0x27d4eb2f;
const XXHASH32_PRIME5 = 0x165667b1;

export const CHECKSUM_ALGORITHMS = Object.freeze({
  crc32: 'crc32',
  adler32: 'adler32',
  fnv1a32: 'fnv1a32',
  fnv1a64: 'fnv1a64',
  sha1: 'SHA-1',
  sha256: 'SHA-256',
  sha384: 'SHA-384',
  sha512: 'SHA-512',
});

export const CHECKSUM_KNOWN_VECTORS = Object.freeze({
  ascii123456789: Object.freeze({
    input: '123456789',
    crc32: 'cbf43926',
    adler32: '091e01de',
    fnv1a32: 'bb86b11c',
    fnv1a64: '06d5573923c6cdfc',
  }),
  hello: Object.freeze({
    input: 'hello',
    crc32: '3610a686',
    adler32: '062c0215',
    fnv1a32: '4f9f2cab',
    fnv1a64: 'a430d84680aabd0b',
  }),
  empty: Object.freeze({
    input: '',
    crc32: '00000000',
    adler32: '00000001',
    fnv1a32: '811c9dc5',
    fnv1a64: 'cbf29ce484222325',
  }),
});

const CRC32_TABLE = new Uint32Array(256);
for (let index = 0; index < CRC32_TABLE.length; index++) {
  let value = index;
  for (let bit = 0; bit < 8; bit++) {
    value = (value & 1) ? (CRC32_POLYNOMIAL ^ (value >>> 1)) : (value >>> 1);
  }
  CRC32_TABLE[index] = value >>> 0;
}

function positiveInteger(value, name) {
  const number = Number(value);
  if (!Number.isFinite(number) || !Number.isInteger(number) || number <= 0) {
    throw new RangeError(`${name} must be a positive integer`);
  }
  return number;
}

function positiveSafeInteger(value, name, max = Number.MAX_SAFE_INTEGER) {
  const number = positiveInteger(value, name);
  if (number > max) {
    throw new RangeError(`${name} must be <= ${max}`);
  }
  return number;
}

function normalizeAlgorithmName(algorithm) {
  return String(algorithm ?? '').trim().toLowerCase().replace(/[\s_-]/g, '');
}

function bytesToHex(bytes) {
  let hex = '';
  for (const byte of bytes) hex += byte.toString(16).padStart(2, '0');
  return hex;
}

function legacySha1InputBytes(data) {
  if (typeof data !== 'string') return Array.from(checksumByteView(data));
  const out = [];
  const text = String(data);
  for (let index = 0; index < text.length; index++) {
    const code = text.charCodeAt(index);
    if (code < 0x80) {
      out.push(code);
    } else if (code < 0x800) {
      out.push(0xc0 | (code >> 6), 0x80 | (code & 0x3f));
    } else {
      out.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f));
    }
  }
  return out;
}

function legacySha1Words(data) {
  const bytes = legacySha1InputBytes(data);
  const bitLength = bytes.length * 8;
  const bitLengthHigh = Math.floor(bitLength / 0x100000000) >>> 0;
  const bitLengthLow = bitLength >>> 0;
  bytes.push(0x80);
  while ((bytes.length % 64) !== 56) bytes.push(0);
  bytes.push(
    (bitLengthHigh >>> 24) & 0xff,
    (bitLengthHigh >>> 16) & 0xff,
    (bitLengthHigh >>> 8) & 0xff,
    bitLengthHigh & 0xff,
    (bitLengthLow >>> 24) & 0xff,
    (bitLengthLow >>> 16) & 0xff,
    (bitLengthLow >>> 8) & 0xff,
    bitLengthLow & 0xff,
  );

  let h0 = 0x67452301;
  let h1 = 0xefcdab89;
  let h2 = 0x98badcfe;
  let h3 = 0x10325476;
  let h4 = 0xc3d2e1f0;

  for (let offset = 0; offset < bytes.length; offset += 64) {
    const words = new Array(80);
    for (let index = 0; index < 16; index++) {
      const base = offset + index * 4;
      words[index] = (bytes[base] << 24) | (bytes[base + 1] << 16) | (bytes[base + 2] << 8) | bytes[base + 3];
    }
    for (let index = 16; index < 80; index++) {
      const value = words[index - 3] ^ words[index - 8] ^ words[index - 14] ^ words[index - 16];
      words[index] = (value << 1) | (value >>> 31);
    }

    let a = h0;
    let b = h1;
    let c = h2;
    let d = h3;
    let e = h4;
    for (let index = 0; index < 80; index++) {
      let f;
      let k;
      if (index < 20) {
        f = (b & c) | (~b & d);
        k = 0x5a827999;
      } else if (index < 40) {
        f = b ^ c ^ d;
        k = 0x6ed9eba1;
      } else if (index < 60) {
        f = (b & c) | (b & d) | (c & d);
        k = 0x8f1bbcdc;
      } else {
        f = b ^ c ^ d;
        k = 0xca62c1d6;
      }
      const temp = (((a << 5) | (a >>> 27)) + f + e + k + words[index]) | 0;
      e = d;
      d = c;
      c = (b << 30) | (b >>> 2);
      b = a;
      a = temp;
    }

    h0 = (h0 + a) | 0;
    h1 = (h1 + b) | 0;
    h2 = (h2 + c) | 0;
    h3 = (h3 + d) | 0;
    h4 = (h4 + e) | 0;
  }

  return [h0, h1, h2, h3, h4];
}

export function checksumByteView(data) {
  if (typeof data === 'string') return encodeUtf8(data);
  if (Array.isArray(data)) return new Uint8Array(data.map((value) => Number(value) & 0xff));
  return bufferByteView(data);
}

export function checksumHex32(value) {
  return (Number(value) >>> 0).toString(16).padStart(8, '0');
}

export function checksumHex64(value) {
  return (BigInt(value) & UINT64_MASK).toString(16).padStart(16, '0');
}

export function hexTailUint32(hex, fallback = 0) {
  const tail = String(hex ?? '').slice(-8);
  const parsed = Number.parseInt(tail, 16);
  return Number.isFinite(parsed) ? parsed >>> 0 : Number(fallback) >>> 0;
}

export function legacySha1Hex(data) {
  return legacySha1Words(data).map((word) => checksumHex32(word)).join('');
}

export function crc32(data, previousCrc = 0) {
  const bytes = checksumByteView(data);
  let checksum = (Number(previousCrc) ^ 0xffffffff) >>> 0;
  for (let index = 0; index < bytes.byteLength; index++) {
    checksum = (CRC32_TABLE[(checksum ^ bytes[index]) & 0xff] ^ (checksum >>> 8)) >>> 0;
  }
  return (checksum ^ 0xffffffff) >>> 0;
}

export function adler32(data, previousAdler = 1) {
  const bytes = checksumByteView(data);
  let s1 = Number(previousAdler) & 0xffff;
  let s2 = (Number(previousAdler) >>> 16) & 0xffff;
  for (let index = 0; index < bytes.byteLength; index++) {
    s1 = (s1 + bytes[index]) % ADLER32_BASE;
    s2 = (s2 + s1) % ADLER32_BASE;
  }
  return (((s2 << 16) >>> 0) | s1) >>> 0;
}

export function fnv1a32(data, seed = FNV1A32_OFFSET_BASIS) {
  const bytes = checksumByteView(data);
  let hash = Number(seed) >>> 0;
  for (let index = 0; index < bytes.byteLength; index++) {
    hash = fnv1aByteStep32(hash, bytes[index]);
  }
  return hash >>> 0;
}

function fnv1aByteStep32(hash, byte) {
  return Math.imul(((Number(hash) >>> 0) ^ (Number(byte) & 0xff)) >>> 0, FNV1A32_PRIME) >>> 0;
}

function sequenceCount(values) {
  const count = Number(values?.length || 0);
  return Number.isFinite(count) && count > 0 ? Math.trunc(count) : 0;
}

export function fnv1a64(data, seed = FNV1A64_OFFSET_BASIS) {
  const bytes = checksumByteView(data);
  let hash = BigInt(seed) & UINT64_MASK;
  for (let index = 0; index < bytes.byteLength; index++) {
    hash = ((hash ^ BigInt(bytes[index])) * FNV1A64_PRIME) & UINT64_MASK;
  }
  return hash;
}

export function fnv1aStringCodeUnit32(data, options = {}) {
  const text = String(data ?? '');
  const seed = Number(options.seed ?? FNV1A32_OFFSET_BASIS) >>> 0;
  const reverse = !!options.reverse;
  let hash = seed;
  if (reverse) {
    for (let index = text.length - 1; index >= 0; index--) {
      hash = Math.imul((hash ^ text.charCodeAt(index)) >>> 0, FNV1A32_PRIME) >>> 0;
    }
    return hash >>> 0;
  }
  for (let index = 0; index < text.length; index++) {
    hash = Math.imul((hash ^ text.charCodeAt(index)) >>> 0, FNV1A32_PRIME) >>> 0;
  }
  return hash >>> 0;
}

export function fnv1aStringCodePointHead32(data, options = {}) {
  const text = String(data ?? '');
  let hash = Number(options.seed ?? FNV1A32_OFFSET_BASIS) >>> 0;
  for (const char of text) {
    hash = Math.imul((hash ^ char.charCodeAt(0)) >>> 0, FNV1A32_PRIME) >>> 0;
  }
  return hash >>> 0;
}

export function fnv1aLowByteString32(data, options = {}) {
  const text = String(data ?? '');
  let hash = Number(options.seed ?? FNV1A32_OFFSET_BASIS) >>> 0;
  for (let index = 0; index < text.length; index++) {
    hash = fnv1aByteStep32(hash, text.charCodeAt(index));
  }
  return hash >>> 0;
}

export function fnv1aTaggedFloat32Sequence32(values, options = {}) {
  const count = sequenceCount(values);
  const tag = String(options.tag ?? 'f32');
  let hash = fnv1aLowByteString32(`${tag}:${count}:`, { seed: options.seed });
  const scratch = new ArrayBuffer(4);
  const view = new DataView(scratch);
  const bytes = new Uint8Array(scratch);
  for (let index = 0; index < count; index++) {
    view.setFloat32(0, Number.isFinite(values?.[index]) ? values[index] : 0, true);
    for (let byte = 0; byte < 4; byte++) hash = fnv1aByteStep32(hash, bytes[byte]);
  }
  return hash >>> 0;
}

export function fnv1aTaggedUint32Sequence32(values, options = {}) {
  const count = sequenceCount(values);
  const tag = String(options.tag ?? 'u32');
  let hash = fnv1aLowByteString32(`${tag}:${count}:`, { seed: options.seed });
  const scratch = new ArrayBuffer(4);
  const view = new DataView(scratch);
  const bytes = new Uint8Array(scratch);
  for (let index = 0; index < count; index++) {
    view.setUint32(0, Number.isFinite(values?.[index]) ? values[index] >>> 0 : 0, true);
    for (let byte = 0; byte < 4; byte++) hash = fnv1aByteStep32(hash, bytes[byte]);
  }
  return hash >>> 0;
}

export function legacyAvalancheUint32Hash32(value) {
  let hash = Number(value) >>> 0;
  hash = (hash ^ (hash >>> 16)) >>> 0;
  hash = Math.imul(hash, 0x7feb352d) >>> 0;
  hash = (hash ^ (hash >>> 15)) >>> 0;
  hash = Math.imul(hash, 0x846ca68b) >>> 0;
  hash = (hash ^ (hash >>> 16)) >>> 0;
  return hash >>> 0;
}

export function legacyAvalancheMixUint32Hash32(hash, value, multiplier = 0x9e3779b1) {
  const mixed = ((Number(hash) >>> 0) ^ Math.imul(Number(value) >>> 0, Number(multiplier) >>> 0)) >>> 0;
  return legacyAvalancheUint32Hash32(mixed);
}

export function fnv1aUint32Sequence32(values, options = {}) {
  let hash = Number(options.seed ?? FNV1A32_OFFSET_BASIS) >>> 0;
  for (const value of values ?? []) {
    const word = Number(value) >>> 0;
    hash = Math.imul((hash ^ (word & 0xff)) >>> 0, FNV1A32_PRIME) >>> 0;
    hash = Math.imul((hash ^ ((word >>> 8) & 0xff)) >>> 0, FNV1A32_PRIME) >>> 0;
    hash = Math.imul((hash ^ ((word >>> 16) & 0xff)) >>> 0, FNV1A32_PRIME) >>> 0;
    hash = Math.imul((hash ^ ((word >>> 24) & 0xff)) >>> 0, FNV1A32_PRIME) >>> 0;
  }
  return hash >>> 0;
}

export function fnv1aInt32Sequence32(values, options = {}) {
  let hash = Number(options.seed ?? FNV1A32_OFFSET_BASIS);
  for (const value of values ?? []) {
    hash = Math.imul(hash ^ (Number(value) | 0), FNV1A32_PRIME);
  }
  return hash >>> 0;
}

function xxHash32ByteView(data) {
  if (data instanceof Uint8Array) return data;
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  if (ArrayBuffer.isView(data)) return new Uint8Array(data.buffer);
  return bufferByteView(data);
}

function xxHash32Length(data, bytes) {
  const length = Number(data?.length);
  return Number.isFinite(length) ? Math.max(0, Math.trunc(length)) : bytes.byteLength;
}

function xxHash32ReadU32(bytes, offset) {
  return (bytes[offset] |
          (bytes[offset + 1] << 8) |
          (bytes[offset + 2] << 16) |
          (bytes[offset + 3] << 24)) >>> 0;
}

export function xxHash32(data, seed = 0) {
  const bytes = xxHash32ByteView(data);
  const len = xxHash32Length(data, bytes);
  let h32;
  let index = 0;

  if (len >= 16) {
    const limit = len - 16;
    let v1 = (seed + XXHASH32_PRIME1 + XXHASH32_PRIME2) >>> 0;
    let v2 = (seed + XXHASH32_PRIME2) >>> 0;
    let v3 = seed >>> 0;
    let v4 = (seed - XXHASH32_PRIME1) >>> 0;

    do {
      v1 = Math.imul(v1 + Math.imul(xxHash32ReadU32(bytes, index), XXHASH32_PRIME2) >>> 0, XXHASH32_PRIME1);
      v1 = ((v1 << 13) | (v1 >>> 19)) >>> 0;
      index += 4;

      v2 = Math.imul(v2 + Math.imul(xxHash32ReadU32(bytes, index), XXHASH32_PRIME2) >>> 0, XXHASH32_PRIME1);
      v2 = ((v2 << 13) | (v2 >>> 19)) >>> 0;
      index += 4;

      v3 = Math.imul(v3 + Math.imul(xxHash32ReadU32(bytes, index), XXHASH32_PRIME2) >>> 0, XXHASH32_PRIME1);
      v3 = ((v3 << 13) | (v3 >>> 19)) >>> 0;
      index += 4;

      v4 = Math.imul(v4 + Math.imul(xxHash32ReadU32(bytes, index), XXHASH32_PRIME2) >>> 0, XXHASH32_PRIME1);
      v4 = ((v4 << 13) | (v4 >>> 19)) >>> 0;
      index += 4;
    } while (index <= limit);

    h32 = (((v1 << 1) | (v1 >>> 31)) +
           ((v2 << 7) | (v2 >>> 25)) +
           ((v3 << 12) | (v3 >>> 20)) +
           ((v4 << 18) | (v4 >>> 14))) >>> 0;
  } else {
    h32 = (seed + XXHASH32_PRIME5) >>> 0;
  }

  h32 = (h32 + len) >>> 0;

  while (index + 4 <= len) {
    h32 = (h32 + Math.imul(xxHash32ReadU32(bytes, index), XXHASH32_PRIME3)) >>> 0;
    h32 = Math.imul((h32 << 17) | (h32 >>> 15), XXHASH32_PRIME4) >>> 0;
    index += 4;
  }

  while (index < len) {
    h32 = (h32 + Math.imul(bytes[index], XXHASH32_PRIME5)) >>> 0;
    h32 = Math.imul((h32 << 11) | (h32 >>> 21), XXHASH32_PRIME1) >>> 0;
    index++;
  }

  h32 ^= h32 >>> 15;
  h32 = Math.imul(h32, XXHASH32_PRIME2) >>> 0;
  h32 ^= h32 >>> 13;
  h32 = Math.imul(h32, XXHASH32_PRIME3) >>> 0;
  h32 ^= h32 >>> 16;

  return h32 >>> 0;
}

export function legacyFnv1aByteSequenceHash32(data, options = {}) {
  const bytes = checksumByteView(data);
  const stride = Math.max(1, Math.trunc(Number(options.stride ?? 1) || 1));
  const offsets = Array.isArray(options.offsets)
    ? options.offsets.map((offset) => Math.trunc(Number(offset) || 0)).filter((offset) => offset >= 0 && offset < stride)
    : null;
  let hash = Number(options.seed ?? FNV1A32_OFFSET_BASIS) >>> 0;
  if (offsets?.length) {
    for (let base = 0; base < bytes.byteLength; base += stride) {
      for (const offset of offsets) {
        const index = base + offset;
        if (index >= bytes.byteLength) continue;
        hash = (hash ^ bytes[index]) * FNV1A32_PRIME >>> 0;
      }
    }
    return hash >>> 0;
  }
  for (let index = 0; index < bytes.byteLength; index++) {
    hash = (hash ^ bytes[index]) * FNV1A32_PRIME >>> 0;
  }
  return hash >>> 0;
}

export function legacyFnv1aNumberSequenceHash32(values, seed = FNV1A32_OFFSET_BASIS) {
  let hash = Number(seed);
  for (const value of values ?? []) {
    hash = (hash ^ (Number(value) || 0)) * FNV1A32_PRIME;
  }
  return hash >>> 0;
}

export function legacyFnv1aStringHash32(data, seed = FNV1A32_OFFSET_BASIS) {
  const text = String(data ?? '');
  let hash = Number(seed) >>> 0;
  for (let index = 0; index < text.length; index++) {
    hash ^= text.charCodeAt(index);
    hash = (hash * FNV1A32_PRIME) >>> 0;
  }
  return hash >>> 0;
}

export function legacyDjb2XorStringHash32(data, seed = 5381) {
  const text = String(data ?? '');
  let hash = Number(seed) | 0;
  for (let index = 0; index < text.length; index++) {
    hash = ((hash << 5) + hash) ^ text.charCodeAt(index);
  }
  return hash >>> 0;
}

export function legacyUnsignedStringHash31(data, seed = 0) {
  const text = String(data ?? '');
  let hash = Number(seed) >>> 0;
  for (let index = 0; index < text.length; index++) {
    hash = (hash * 31 + text.charCodeAt(index)) >>> 0;
  }
  return hash >>> 0;
}

export function legacyStringHash32(data) {
  const text = String(data ?? '');
  let hash = 0;
  for (let index = 0; index < text.length; index++) {
    hash = ((hash << 5) - hash) + text.charCodeAt(index);
    hash = hash & hash;
  }
  return hash;
}

export function legacyScaledNumberSequenceHash32(values, options = {}) {
  const length = Number(values?.length ?? 0);
  const limit = options.limit == null ? length : Math.max(0, Math.trunc(Number(options.limit) || 0));
  const count = Math.min(Math.max(0, length), limit);
  const scale = Number(options.scale ?? 1);
  let hash = Number(options.seed ?? 0) | 0;
  for (let index = 0; index < count; index++) {
    hash = ((hash << 5) - hash + Math.floor(Number(values[index]) * scale)) | 0;
  }
  return hash | 0;
}

export function bufferHash(data, algorithm = CHECKSUM_ALGORITHMS.crc32) {
  const bytes = checksumByteView(data);
  const key = normalizeAlgorithmName(algorithm);
  if (key === 'crc32') {
    const value = crc32(bytes);
    return { algorithm: CHECKSUM_ALGORITHMS.crc32, bits: 32, byteLength: bytes.byteLength, value, hex: checksumHex32(value) };
  }
  if (key === 'adler32') {
    const value = adler32(bytes);
    return { algorithm: CHECKSUM_ALGORITHMS.adler32, bits: 32, byteLength: bytes.byteLength, value, hex: checksumHex32(value) };
  }
  if (key === 'fnv1a32' || key === 'fnv32') {
    const value = fnv1a32(bytes);
    return { algorithm: CHECKSUM_ALGORITHMS.fnv1a32, bits: 32, byteLength: bytes.byteLength, value, hex: checksumHex32(value) };
  }
  if (key === 'fnv1a64' || key === 'fnv64') {
    const value = fnv1a64(bytes);
    return { algorithm: CHECKSUM_ALGORITHMS.fnv1a64, bits: 64, byteLength: bytes.byteLength, value, hex: checksumHex64(value) };
  }
  throw new RangeError(`unsupported buffer hash algorithm: ${algorithm}`);
}

export function checksumReport(data) {
  const bytes = checksumByteView(data);
  const crc = crc32(bytes);
  const adler = adler32(bytes);
  const fnv32 = fnv1a32(bytes);
  const fnv64 = fnv1a64(bytes);
  return {
    byteLength: bytes.byteLength,
    crc32: crc,
    crc32Hex: checksumHex32(crc),
    adler32: adler,
    adler32Hex: checksumHex32(adler),
    fnv1a32: fnv32,
    fnv1a32Hex: checksumHex32(fnv32),
    fnv1a64: fnv64,
    fnv1a64Hex: checksumHex64(fnv64),
  };
}

export function checksumBlockReport(data, options = {}) {
  const bytes = checksumByteView(data);
  const blockSize = positiveInteger(options.blockSize ?? 65536, 'blockSize');
  const blocks = [];
  for (let byteOffset = 0; byteOffset < bytes.byteLength; byteOffset += blockSize) {
    const block = bytes.subarray(byteOffset, Math.min(bytes.byteLength, byteOffset + blockSize));
    const crc = crc32(block);
    const adler = adler32(block);
    const fnv32 = fnv1a32(block);
    blocks.push({
      blockIndex: blocks.length,
      byteOffset,
      byteLength: block.byteLength,
      crc32: crc,
      crc32Hex: checksumHex32(crc),
      adler32: adler,
      adler32Hex: checksumHex32(adler),
      fnv1a32: fnv32,
      fnv1a32Hex: checksumHex32(fnv32),
    });
  }
  return {
    ...checksumReport(bytes),
    blockSize,
    blockCount: blocks.length,
    blocks: Object.freeze(blocks),
  };
}

export function rollingHash32(data, windowSize, options = {}) {
  const bytes = checksumByteView(data);
  const size = positiveInteger(windowSize, 'windowSize');
  const base = positiveSafeInteger(options.base ?? 257, 'base', 65536);
  const modulus = positiveSafeInteger(options.modulus ?? 1000000007, 'modulus', 0xffffffff);
  const count = size > bytes.byteLength ? 0 : bytes.byteLength - size + 1;
  const hashes = new Uint32Array(count);
  if (count === 0) {
    return { windowSize: size, count, base, modulus, hashes };
  }

  let highestBase = 1;
  for (let index = 1; index < size; index++) highestBase = (highestBase * base) % modulus;

  let hash = 0;
  for (let index = 0; index < size; index++) {
    hash = (hash * base + bytes[index]) % modulus;
  }
  hashes[0] = hash >>> 0;

  for (let index = size; index < bytes.byteLength; index++) {
    const oldByte = bytes[index - size];
    hash = (hash - (oldByte * highestBase) % modulus + modulus) % modulus;
    hash = (hash * base + bytes[index]) % modulus;
    hashes[index - size + 1] = hash >>> 0;
  }

  return { windowSize: size, count, base, modulus, hashes };
}

export function bufferCompare(left, right) {
  const a = checksumByteView(left);
  const b = checksumByteView(right);
  const sharedLength = Math.min(a.byteLength, b.byteLength);
  let firstDifference = -1;
  let order = 0;
  let equalPrefixBytes = sharedLength;

  for (let index = 0; index < sharedLength; index++) {
    if (a[index] !== b[index]) {
      firstDifference = index;
      equalPrefixBytes = index;
      order = a[index] < b[index] ? -1 : 1;
      break;
    }
  }

  const lengthDelta = a.byteLength - b.byteLength;
  if (order === 0 && lengthDelta !== 0) {
    firstDifference = sharedLength;
    order = lengthDelta < 0 ? -1 : 1;
  }

  return {
    equal: order === 0,
    order,
    firstDifference,
    equalPrefixBytes,
    leftByteLength: a.byteLength,
    rightByteLength: b.byteLength,
    lengthDelta,
  };
}

function normalizeContentHashAlgorithm(algorithm) {
  const key = normalizeAlgorithmName(algorithm || CHECKSUM_ALGORITHMS.sha256);
  if (key === 'sha1') return CHECKSUM_ALGORITHMS.sha1;
  if (key === 'sha256') return CHECKSUM_ALGORITHMS.sha256;
  if (key === 'sha384') return CHECKSUM_ALGORITHMS.sha384;
  if (key === 'sha512') return CHECKSUM_ALGORITHMS.sha512;
  throw new RangeError(`unsupported content hash algorithm: ${algorithm}`);
}

export async function contentHashBytes(data, algorithm = CHECKSUM_ALGORITHMS.sha256) {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) {
    throw new Error('WebCrypto subtle digest is not available');
  }
  const bytes = checksumByteView(data);
  const digest = await subtle.digest(normalizeContentHashAlgorithm(algorithm), bytes);
  return new Uint8Array(digest);
}

export async function contentHashHex(data, algorithm = CHECKSUM_ALGORITHMS.sha256) {
  return bytesToHex(await contentHashBytes(data, algorithm));
}

export default {
  CHECKSUM_ALGORITHMS,
  CHECKSUM_KNOWN_VECTORS,
  FNV1A32_OFFSET_BASIS,
  checksumByteView,
  checksumHex32,
  checksumHex64,
  hexTailUint32,
  legacySha1Hex,
  crc32,
  adler32,
  fnv1a32,
  fnv1a64,
  fnv1aStringCodeUnit32,
  fnv1aStringCodePointHead32,
  fnv1aLowByteString32,
  fnv1aTaggedFloat32Sequence32,
  fnv1aTaggedUint32Sequence32,
  legacyAvalancheUint32Hash32,
  legacyAvalancheMixUint32Hash32,
  fnv1aInt32Sequence32,
  fnv1aUint32Sequence32,
  xxHash32,
  legacyFnv1aByteSequenceHash32,
  legacyFnv1aNumberSequenceHash32,
  legacyFnv1aStringHash32,
  legacyDjb2XorStringHash32,
  legacyUnsignedStringHash31,
  legacyStringHash32,
  legacyScaledNumberSequenceHash32,
  bufferHash,
  checksumReport,
  checksumBlockReport,
  rollingHash32,
  bufferCompare,
  contentHashBytes,
  contentHashHex,
};
