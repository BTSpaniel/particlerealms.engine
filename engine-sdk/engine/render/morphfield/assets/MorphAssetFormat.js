// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

export const MORPH_ASSET_MAGIC = 'MOR2';
export const MORPH_ASSET_HEADER_BYTES = 32;
export const MORPH_ASSET_DIRECTORY_ENTRY_BYTES = 32;
export const MORPH_ASSET_VERSION = Object.freeze({ major: 2, minor: 1 });

export const MORPH_HEADER_FLAG = Object.freeze({
  LITTLE_ENDIAN: 1 << 0,
  HAS_COMPRESSION: 1 << 1,
  HAS_PROVENANCE: 1 << 2,
});

export const MORPH_HEADER_FLAG_MASK = Object.values(MORPH_HEADER_FLAG)
  .reduce((mask, flag) => mask | flag, 0) >>> 0;

export const MORPH_CHUNK_FLAG = Object.freeze({
  REQUIRED: 1 << 0,
  AUTHORITATIVE: 1 << 1,
  DISPOSABLE: 1 << 2,
  TEXT: 1 << 3,
  JSON: 1 << 4,
});

export const MORPH_CHUNK_FLAG_MASK = Object.values(MORPH_CHUNK_FLAG)
  .reduce((mask, flag) => mask | flag, 0) >>> 0;

export const MORPH_COMPRESSION = Object.freeze({
  NONE: 0,
  GZIP: 1,
  DEFLATE: 2,
});

export const MORPH_COMPRESSION_NAME = Object.freeze({
  [MORPH_COMPRESSION.NONE]: 'none',
  [MORPH_COMPRESSION.GZIP]: 'gzip',
  [MORPH_COMPRESSION.DEFLATE]: 'deflate',
});

export const MORPH_CHUNK_TYPE = Object.freeze({
  MANIFEST: 'MANF',
  BINARY: 'BINA',
  CERTIFICATES: 'CERT',
  RESIDUAL: 'RSDL',
  KERNELS: 'KERN',
  SURFACE_CACHE: 'SURF',
  PROVENANCE: 'PROV',
});

export const MORPH_KNOWN_CHUNK_TYPES = Object.freeze(Object.values(MORPH_CHUNK_TYPE));

export const MORPH_ASSET_LIMITS = Object.freeze({
  MAX_FILE_BYTES: 512 * 1024 * 1024,
  MAX_CHUNKS: 4096,
  MAX_CHUNK_RAW_BYTES: 256 * 1024 * 1024,
  MAX_TOTAL_RAW_BYTES: 1024 * 1024 * 1024,
  MAX_MANIFEST_BYTES: 16 * 1024 * 1024,
  MAX_PROVENANCE_BYTES: 8 * 1024 * 1024,
});

export function fourCCToUint32(value) {
  if (typeof value !== 'string' || value.length !== 4 || !/^[\x20-\x7e]{4}$/u.test(value)) {
    throw new RangeError(`Chunk type must be exactly four printable ASCII characters: ${String(value)}`);
  }
  return (
    value.charCodeAt(0)
    | (value.charCodeAt(1) << 8)
    | (value.charCodeAt(2) << 16)
    | (value.charCodeAt(3) << 24)
  ) >>> 0;
}

export function uint32ToFourCC(value) {
  const number = Number(value) >>> 0;
  return String.fromCharCode(
    number & 0xff,
    (number >>> 8) & 0xff,
    (number >>> 16) & 0xff,
    (number >>> 24) & 0xff,
  );
}
