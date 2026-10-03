// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

import { crc32 } from '../../../core/math/ChecksumMath.js';
import { MorphFieldError, failMorphField } from '../core/errors.js';
import { NexelScene } from '../core/NexelScene.js';
import { canonicalParse, canonicalStringify, utf8Decode, utf8Encode } from '../core/serialization.js';
import { MORPHFIELD_SCHEMA_IDS } from '../schemas/ids.js';
import {
  MORPH_ASSET_DIRECTORY_ENTRY_BYTES,
  MORPH_ASSET_HEADER_BYTES,
  MORPH_ASSET_LIMITS,
  MORPH_ASSET_MAGIC,
  MORPH_ASSET_VERSION,
  MORPH_CHUNK_FLAG,
  MORPH_CHUNK_FLAG_MASK,
  MORPH_CHUNK_TYPE,
  MORPH_COMPRESSION,
  MORPH_COMPRESSION_NAME,
  MORPH_HEADER_FLAG,
  MORPH_HEADER_FLAG_MASK,
  MORPH_KNOWN_CHUNK_TYPES,
  fourCCToUint32,
  uint32ToFourCC,
} from './MorphAssetFormat.js';

const INVALID_DEPENDENCY = 0xffffffff;

function align8(value) {
  return (value + 7) & ~7;
}

function maximum(options, key) {
  const configured = Number(options?.limits?.[key] ?? MORPH_ASSET_LIMITS[key]);
  const hardMaximum = MORPH_ASSET_LIMITS[key];
  if (!Number.isSafeInteger(configured) || configured < 0 || configured > hardMaximum) {
    failMorphField('MORPH_LIMIT_RANGE', `${key} must be an integer no greater than ${hardMaximum}`, { key, configured });
  }
  return configured;
}

function failByteLimit(path, byteLength, maximumBytes, code = 'MORPH_FILE_SIZE_LIMIT') {
  failMorphField(code, `${path} exceeds the ${maximumBytes}-byte limit`, {
    path,
    byteLength,
    maximumBytes,
  });
}

function byteView(
  value,
  path = 'data',
  maximumBytes = Infinity,
  copy = true,
  limitCode = 'MORPH_FILE_SIZE_LIMIT',
) {
  let bytes;
  if (value instanceof Uint8Array) bytes = value;
  else if (value instanceof ArrayBuffer) bytes = new Uint8Array(value);
  if (ArrayBuffer.isView(value)) {
    bytes = new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  }
  if (typeof value === 'string') {
    if (value.length > maximumBytes) failByteLimit(path, value.length, maximumBytes, limitCode);
    bytes = utf8Encode(value);
  }
  if (!bytes) failMorphField('EXPECTED_BYTES', `${path} must be an ArrayBuffer, typed array, or string`, { path });
  if (bytes.byteLength > maximumBytes) failByteLimit(path, bytes.byteLength, maximumBytes, limitCode);
  return copy ? new Uint8Array(bytes) : bytes;
}

function metadataChecksum(bytes, minor, directoryOffset, directoryEnd) {
  let checksum = crc32(bytes.subarray(0, 28));
  if (minor >= 1) checksum = crc32(bytes.subarray(directoryOffset, directoryEnd), checksum);
  return checksum >>> 0;
}

function validateChunkFlags(type, flags, context) {
  if ((flags & ~MORPH_CHUNK_FLAG_MASK) !== 0) {
    failMorphField('UNKNOWN_MORPH_CHUNK_FLAGS', `${context} uses unknown chunk flag bits`, { type, flags });
  }
  if ((flags & MORPH_CHUNK_FLAG.JSON) !== 0 && (flags & MORPH_CHUNK_FLAG.TEXT) === 0) {
    failMorphField('INVALID_MORPH_CHUNK_FLAGS', `${context} marks JSON data without TEXT`, { type, flags });
  }
  if ((flags & MORPH_CHUNK_FLAG.AUTHORITATIVE) !== 0 && (flags & MORPH_CHUNK_FLAG.DISPOSABLE) !== 0) {
    failMorphField('INVALID_MORPH_CHUNK_FLAGS', `${context} cannot be both authoritative and disposable`, { type, flags });
  }
  const manifestFlags = MORPH_CHUNK_FLAG.REQUIRED
    | MORPH_CHUNK_FLAG.AUTHORITATIVE
    | MORPH_CHUNK_FLAG.TEXT
    | MORPH_CHUNK_FLAG.JSON;
  if (type === MORPH_CHUNK_TYPE.MANIFEST && flags !== manifestFlags) {
    failMorphField('INVALID_MORPH_MANIFEST', 'MANF must be required, authoritative, UTF-8 text, and JSON', { flags });
  }
  const provenanceFlags = MORPH_CHUNK_FLAG.TEXT | MORPH_CHUNK_FLAG.JSON;
  if (type === MORPH_CHUNK_TYPE.PROVENANCE && flags !== provenanceFlags) {
    failMorphField('INVALID_MORPH_PROVENANCE', 'PROV must be optional disposable-neutral UTF-8 JSON metadata', { flags });
  }
}

function compressionCode(value) {
  if (value === undefined || value === 'none' || value === MORPH_COMPRESSION.NONE) return MORPH_COMPRESSION.NONE;
  if (value === 'gzip' || value === MORPH_COMPRESSION.GZIP) return MORPH_COMPRESSION.GZIP;
  if (value === 'deflate' || value === MORPH_COMPRESSION.DEFLATE) return MORPH_COMPRESSION.DEFLATE;
  if (value === 'auto') return 'auto';
  failMorphField('UNKNOWN_MORPH_COMPRESSION', `Unknown .morph compression: ${String(value)}`);
}

async function transformStream(bytes, compression, decode, outputLimit = Infinity) {
  const name = MORPH_COMPRESSION_NAME[compression];
  const Constructor = decode ? globalThis.DecompressionStream : globalThis.CompressionStream;
  if (typeof Constructor !== 'function') {
    failMorphField(
      decode ? 'MORPH_DECOMPRESSION_UNAVAILABLE' : 'MORPH_COMPRESSION_UNAVAILABLE',
      `${decode ? 'DecompressionStream' : 'CompressionStream'} is required for ${name} .morph chunks`,
      { compression: name },
    );
  }
  try {
    const transform = new Constructor(name);
    const reader = transform.readable.getReader();
    const writer = transform.writable.getWriter();
    const readResult = (async () => {
      const chunks = [];
      let totalBytes = 0;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = byteView(value, 'compression output');
        chunks.push(chunk);
        totalBytes += chunk.byteLength;
        if (totalBytes > outputLimit) {
          await reader.cancel('MorphField decompression output limit exceeded');
          failMorphField('MORPH_DECOMPRESSION_SIZE_LIMIT', `Decompressed chunk exceeded its declared ${outputLimit}-byte size`, {
            outputLimit,
            totalBytes,
          });
        }
      }
      const result = new Uint8Array(totalBytes);
      let offset = 0;
      for (const chunk of chunks) {
        result.set(chunk, offset);
        offset += chunk.byteLength;
      }
      return result;
    })();
    await writer.write(bytes);
    await writer.close();
    return await readResult;
  } catch (error) {
    if (error instanceof MorphFieldError) throw error;
    failMorphField(decode ? 'MORPH_DECOMPRESSION_FAILED' : 'MORPH_COMPRESSION_FAILED',
      `${name} ${decode ? 'decompression' : 'compression'} failed`, {
        compression: name,
        cause: String(error?.message || error),
      });
  }
}

async function compressBytes(bytes, requested, threshold) {
  const code = compressionCode(requested);
  if (code !== 'auto') {
    if (code === MORPH_COMPRESSION.NONE) return { compression: code, bytes };
    return { compression: code, bytes: await transformStream(bytes, code, false) };
  }
  if (bytes.byteLength < threshold || typeof globalThis.CompressionStream !== 'function') {
    return { compression: MORPH_COMPRESSION.NONE, bytes };
  }
  const candidates = [{ compression: MORPH_COMPRESSION.NONE, bytes }];
  for (const candidate of [MORPH_COMPRESSION.GZIP, MORPH_COMPRESSION.DEFLATE]) {
    try {
      candidates.push({ compression: candidate, bytes: await transformStream(bytes, candidate, false) });
    } catch (error) {
      if (!(error instanceof MorphFieldError) || error.code !== 'MORPH_COMPRESSION_FAILED') throw error;
    }
  }
  candidates.sort((a, b) => a.bytes.byteLength - b.bytes.byteLength || a.compression - b.compression);
  return candidates[0];
}

async function decompressBytes(bytes, compression, rawLength) {
  if (compression === MORPH_COMPRESSION.NONE) return new Uint8Array(bytes);
  return transformStream(bytes, compression, true, rawLength);
}

function normalizeScene(sceneInput) {
  if (sceneInput instanceof NexelScene) return sceneInput;
  return NexelScene.fromJSON(sceneInput);
}

function provenanceString(value, key, path) {
  if (typeof value[key] !== 'string') {
    failMorphField('INVALID_MORPH_PROVENANCE', `${path}.${key} must be a string`);
  }
  const length = Array.from(value[key]).length;
  if (length < 1 || length > 512) {
    failMorphField('INVALID_MORPH_PROVENANCE', `${path}.${key} must contain 1..512 Unicode code points`);
  }
}

function validProvenanceDate(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,9}))?Z)?$/u.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = match[4] === undefined ? 0 : Number(match[4]);
  const minute = match[5] === undefined ? 0 : Number(match[5]);
  const second = match[6] === undefined ? 0 : Number(match[6]);
  if (month < 1 || month > 12 || hour > 23 || minute > 59 || second > 59) return false;
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const daysInMonth = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1];
  return day >= 1 && day <= daysInMonth;
}

function validateProvenance(value, path, manifest = null) {
  const keys = Object.keys(value);
  if (keys.length > 256) {
    failMorphField('INVALID_MORPH_PROVENANCE', `${path} exceeds 256 properties`);
  }
  for (const key of ['author', 'generator', 'capabilityProfile']) {
    if (Object.prototype.hasOwnProperty.call(value, key)) provenanceString(value, key, path);
  }
  if (Object.prototype.hasOwnProperty.call(value, 'date')) {
    if (typeof value.date !== 'string' || !validProvenanceDate(value.date)) {
      failMorphField('INVALID_MORPH_PROVENANCE', `${path}.date must be a real UTC calendar date in the canonical provenance format`);
    }
  }
  if (Object.prototype.hasOwnProperty.call(value, 'scene')) {
    if (typeof value.scene !== 'string'
        || Array.from(value.scene).length < 1
        || Array.from(value.scene).length > 128
        || /[\u0000-\u001f\u007f]/u.test(value.scene)) {
      failMorphField('INVALID_MORPH_PROVENANCE', `${path}.scene must be a stable Nexel scene id`);
    }
    if (manifest && value.scene !== manifest.id) {
      failMorphField('MORPH_PROVENANCE_SCENE_MISMATCH', `${path}.scene does not match the authoritative MANF scene`, {
        expected: manifest.id,
        received: value.scene,
      });
    }
  }
  for (const key of ['sourceRevision', 'certificateRevision']) {
    if (Object.prototype.hasOwnProperty.call(value, key)
        && (!Number.isSafeInteger(value[key]) || value[key] < 0)) {
      failMorphField('INVALID_MORPH_PROVENANCE', `${path}.${key} must be a non-negative safe integer`);
    }
  }
  if (manifest && Object.prototype.hasOwnProperty.call(value, 'sourceRevision')
      && value.sourceRevision !== manifest.revision) {
    failMorphField('MORPH_PROVENANCE_REVISION_MISMATCH', `${path}.sourceRevision does not match the authoritative MANF revision`, {
      expected: manifest.revision,
      received: value.sourceRevision,
    });
  }
  if (Object.prototype.hasOwnProperty.call(value, 'records')
      && (!Array.isArray(value.records) || value.records.length > 4096)) {
    failMorphField('INVALID_MORPH_PROVENANCE', `${path}.records must be an array containing at most 4096 values`);
  }
}

function canonicalProvenance(value, options, path = 'provenance', manifest = null) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    failMorphField('INVALID_MORPH_PROVENANCE', `${path} must be a JSON object`);
  }
  const expected = {
    $schema: MORPHFIELD_SCHEMA_IDS.provenance,
    schema: 'morphfield-asset-provenance',
    version: 1,
  };
  for (const [key, expectedValue] of Object.entries(expected)) {
    if (Object.prototype.hasOwnProperty.call(value, key) && value[key] !== expectedValue) {
      failMorphField('INVALID_MORPH_PROVENANCE', `${path}.${key} does not identify the MorphField R2 provenance contract`, {
        key,
        expected: expectedValue,
        received: value[key],
      });
    }
  }
  const normalized = { ...value, ...expected };
  validateProvenance(normalized, path, manifest);
  return canonicalStringify(normalized, options?.canonicalization);
}

function parseCanonicalProvenance(bytes, options, path = 'PROV', manifest = null) {
  const text = utf8Decode(bytes);
  const value = canonicalParse(text, {
    ...options?.canonicalization,
    maximumLength: maximum(options, 'MAX_PROVENANCE_BYTES'),
  });
  const canonical = canonicalProvenance(value, options, path, manifest);
  if (text !== canonical) {
    failMorphField('PROVENANCE_CANONICAL_MISMATCH', `${path} JSON must use its deterministic canonical encoding`);
  }
  return canonicalParse(canonical, options?.canonicalization);
}

function normalizeChunk(input, index, options, manifest) {
  if (!input || typeof input !== 'object') failMorphField('INVALID_MORPH_CHUNK', `chunks[${index}] must be an object`);
  const type = String(input.type || '');
  try {
    fourCCToUint32(type);
  } catch (error) {
    failMorphField('INVALID_MORPH_CHUNK_TYPE', `chunks[${index}].type is invalid`, { type });
  }
  if (type === MORPH_CHUNK_TYPE.MANIFEST) failMorphField('DUPLICATE_MORPH_MANIFEST', 'The semantic manifest is generated automatically');
  const rawFlags = input.flags ?? 0;
  if (!Number.isSafeInteger(rawFlags) || rawFlags < 0 || rawFlags > 0xffffffff) {
    failMorphField('INVALID_MORPH_CHUNK_FLAGS', `chunks[${index}].flags must be an unsigned 32-bit integer`, {
      type,
      flags: rawFlags,
    });
  }
  const required = input.required === true;
  let flags = rawFlags >>> 0;
  if (required) flags |= MORPH_CHUNK_FLAG.REQUIRED;
  if (input.authoritative === true) flags |= MORPH_CHUNK_FLAG.AUTHORITATIVE;
  if (input.disposable === true) flags |= MORPH_CHUNK_FLAG.DISPOSABLE;
  if (input.text === true) flags |= MORPH_CHUNK_FLAG.TEXT;
  if (input.json === true) flags |= MORPH_CHUNK_FLAG.JSON | MORPH_CHUNK_FLAG.TEXT;
  flags >>>= 0;
  validateChunkFlags(type, flags, `chunks[${index}]`);
  const known = MORPH_KNOWN_CHUNK_TYPES.includes(type);
  if (!known && (flags & MORPH_CHUNK_FLAG.REQUIRED) !== 0) {
    failMorphField('UNKNOWN_REQUIRED_MORPH_CHUNK', `Cannot encode unknown required chunk ${type}`);
  }
  if (known && type !== MORPH_CHUNK_TYPE.MANIFEST && (flags & MORPH_CHUNK_FLAG.REQUIRED) !== 0) {
    failMorphField('UNIMPLEMENTED_REQUIRED_MORPH_CHUNK', `Required ${type} chunks are not an implemented authoritative contract`);
  }
  const chunkRawLimit = maximum(options, 'MAX_CHUNK_RAW_BYTES');
  const typeRawLimit = type === MORPH_CHUNK_TYPE.PROVENANCE
    ? maximum(options, 'MAX_PROVENANCE_BYTES')
    : chunkRawLimit;
  const rawLimit = Math.min(chunkRawLimit, typeRawLimit);
  const rawLimitCode = type === MORPH_CHUNK_TYPE.PROVENANCE && typeRawLimit <= chunkRawLimit
    ? 'MORPH_PROVENANCE_SIZE_LIMIT'
    : 'MORPH_CHUNK_SIZE_LIMIT';
  const rawBytes = byteView(input.data, `chunks[${index}].data`, rawLimit, true, rawLimitCode);
  if (type === MORPH_CHUNK_TYPE.PROVENANCE) {
    parseCanonicalProvenance(rawBytes, options, `chunks[${index}].data`, manifest);
  }
  return {
    type,
    flags,
    rawBytes,
    compression: input.compression ?? options.compression ?? 'auto',
    dependency: input.dependency ?? input.dependsOn
      ?? (type === MORPH_CHUNK_TYPE.PROVENANCE ? 0 : INVALID_DEPENDENCY),
  };
}

function resolveDependencies(chunks) {
  for (let index = 0; index < chunks.length; index++) {
    const chunk = chunks[index];
    if (chunk.dependency === undefined || chunk.dependency === null || chunk.dependency === INVALID_DEPENDENCY) {
      chunk.dependency = INVALID_DEPENDENCY;
      continue;
    }
    if (typeof chunk.dependency === 'string') {
      const dependencyIndex = chunks.findIndex((candidate, candidateIndex) => candidateIndex < index && candidate.type === chunk.dependency);
      if (dependencyIndex < 0) {
        failMorphField('INVALID_MORPH_DEPENDENCY', `Chunk ${chunk.type} depends on missing or later chunk ${chunk.dependency}`);
      }
      chunk.dependency = dependencyIndex;
    } else {
      const dependencyIndex = Number(chunk.dependency);
      if (!Number.isInteger(dependencyIndex) || dependencyIndex < 0 || dependencyIndex >= index) {
        failMorphField('INVALID_MORPH_DEPENDENCY', `Chunk ${chunk.type} dependency must reference an earlier chunk`, {
          dependency: chunk.dependency,
          index,
        });
      }
      chunk.dependency = dependencyIndex;
    }
  }
}

export async function encodeMorphAsset(sceneInput, options = {}) {
  const scene = normalizeScene(sceneInput);
  if (options.chunks !== undefined && !Array.isArray(options.chunks)) {
    failMorphField('INVALID_MORPH_CHUNKS', '.morph chunks must be an array');
  }
  const callerChunks = options.chunks ?? [];
  const callerProvenanceCount = callerChunks
    .reduce((count, chunk) => count + (String(chunk?.type || '') === MORPH_CHUNK_TYPE.PROVENANCE ? 1 : 0), 0);
  if (callerProvenanceCount + (options.provenance !== undefined ? 1 : 0) > 1) {
    failMorphField('DUPLICATE_MORPH_PROVENANCE', '.morph assets may contain at most one PROV chunk');
  }
  const manifest = scene.toJSON();
  const manifestBytes = utf8Encode(canonicalStringify(manifest));
  const manifestLimit = maximum(options, 'MAX_MANIFEST_BYTES');
  if (manifestBytes.byteLength > manifestLimit) {
    failMorphField('MORPH_MANIFEST_SIZE_LIMIT', `Semantic manifest exceeds ${manifestLimit} bytes`, {
      byteLength: manifestBytes.byteLength,
    });
  }
  const chunkRawLimit = maximum(options, 'MAX_CHUNK_RAW_BYTES');
  if (manifestBytes.byteLength > chunkRawLimit) {
    failMorphField('MORPH_CHUNK_SIZE_LIMIT', `MANF exceeds the ${chunkRawLimit}-byte raw chunk limit`, {
      type: MORPH_CHUNK_TYPE.MANIFEST,
      byteLength: manifestBytes.byteLength,
    });
  }
  const chunks = [{
    type: MORPH_CHUNK_TYPE.MANIFEST,
    flags: MORPH_CHUNK_FLAG.REQUIRED | MORPH_CHUNK_FLAG.AUTHORITATIVE | MORPH_CHUNK_FLAG.TEXT | MORPH_CHUNK_FLAG.JSON,
    rawBytes: manifestBytes,
    compression: options.manifestCompression ?? options.compression ?? 'auto',
    dependency: INVALID_DEPENDENCY,
  }];
  if (options.provenance !== undefined) {
    const provenanceBytes = utf8Encode(canonicalProvenance(options.provenance, options, 'provenance', manifest));
    const provenanceLimit = maximum(options, 'MAX_PROVENANCE_BYTES');
    if (provenanceBytes.byteLength > provenanceLimit) {
      failMorphField('MORPH_PROVENANCE_SIZE_LIMIT', `Provenance exceeds ${provenanceLimit} bytes`, {
        byteLength: provenanceBytes.byteLength,
      });
    }
    if (provenanceBytes.byteLength > chunkRawLimit) {
      failMorphField('MORPH_CHUNK_SIZE_LIMIT', `PROV exceeds the ${chunkRawLimit}-byte raw chunk limit`, {
        type: MORPH_CHUNK_TYPE.PROVENANCE,
        byteLength: provenanceBytes.byteLength,
      });
    }
    chunks.push({
      type: MORPH_CHUNK_TYPE.PROVENANCE,
      flags: MORPH_CHUNK_FLAG.TEXT | MORPH_CHUNK_FLAG.JSON,
      rawBytes: provenanceBytes,
      compression: options.provenanceCompression ?? options.compression ?? 'auto',
      dependency: 0,
    });
  }
  callerChunks.forEach((chunk, index) => chunks.push(normalizeChunk(chunk, index, options, manifest)));
  const provenanceChunks = chunks.filter(chunk => chunk.type === MORPH_CHUNK_TYPE.PROVENANCE);
  if (provenanceChunks.length > 1) {
    failMorphField('DUPLICATE_MORPH_PROVENANCE', '.morph assets may contain at most one PROV chunk');
  }
  const chunkLimit = maximum(options, 'MAX_CHUNKS');
  if (chunks.length > chunkLimit) failMorphField('MORPH_CHUNK_COUNT_LIMIT', `.morph asset exceeds ${chunkLimit} chunks`);
  const totalRaw = chunks.reduce((sum, chunk) => sum + chunk.rawBytes.byteLength, 0);
  const totalRawLimit = maximum(options, 'MAX_TOTAL_RAW_BYTES');
  if (totalRaw > totalRawLimit) failMorphField('MORPH_TOTAL_RAW_SIZE_LIMIT', `.morph raw chunks exceed ${totalRawLimit} bytes`);
  resolveDependencies(chunks);
  const compressionThreshold = Number(options.compressionThreshold ?? 1024);
  if (!Number.isSafeInteger(compressionThreshold) || compressionThreshold < 0) {
    failMorphField('MORPH_COMPRESSION_THRESHOLD', 'compressionThreshold must be a non-negative integer');
  }
  for (const chunk of chunks) {
    const result = await compressBytes(chunk.rawBytes, chunk.compression, compressionThreshold);
    chunk.compression = result.compression;
    chunk.storedBytes = result.bytes;
    chunk.checksum = crc32(chunk.rawBytes);
  }
  const directoryBytes = chunks.length * MORPH_ASSET_DIRECTORY_ENTRY_BYTES;
  let cursor = align8(MORPH_ASSET_HEADER_BYTES + directoryBytes);
  for (const chunk of chunks) {
    chunk.offset = cursor;
    cursor = align8(cursor + chunk.storedBytes.byteLength);
  }
  const fileSize = cursor;
  const fileLimit = maximum(options, 'MAX_FILE_BYTES');
  if (fileSize > fileLimit || fileSize > 0xffffffff) {
    failMorphField('MORPH_FILE_SIZE_LIMIT', `.morph asset requires ${fileSize} bytes`, { fileSize, fileLimit });
  }
  const bytes = new Uint8Array(fileSize);
  const view = new DataView(bytes.buffer);
  bytes.set(utf8Encode(MORPH_ASSET_MAGIC), 0);
  view.setUint16(4, MORPH_ASSET_VERSION.major, true);
  view.setUint16(6, MORPH_ASSET_VERSION.minor, true);
  view.setUint16(8, MORPH_ASSET_HEADER_BYTES, true);
  view.setUint16(10, MORPH_ASSET_DIRECTORY_ENTRY_BYTES, true);
  let headerFlags = MORPH_HEADER_FLAG.LITTLE_ENDIAN;
  if (chunks.some(chunk => chunk.compression !== MORPH_COMPRESSION.NONE)) headerFlags |= MORPH_HEADER_FLAG.HAS_COMPRESSION;
  if (chunks.some(chunk => chunk.type === MORPH_CHUNK_TYPE.PROVENANCE)) headerFlags |= MORPH_HEADER_FLAG.HAS_PROVENANCE;
  view.setUint32(12, headerFlags, true);
  view.setUint32(16, chunks.length, true);
  view.setUint32(20, MORPH_ASSET_HEADER_BYTES, true);
  view.setUint32(24, fileSize, true);
  view.setUint32(28, 0, true);
  chunks.forEach((chunk, index) => {
    const offset = MORPH_ASSET_HEADER_BYTES + index * MORPH_ASSET_DIRECTORY_ENTRY_BYTES;
    view.setUint32(offset, fourCCToUint32(chunk.type), true);
    view.setUint32(offset + 4, chunk.flags, true);
    view.setUint32(offset + 8, chunk.offset, true);
    view.setUint32(offset + 12, chunk.storedBytes.byteLength, true);
    view.setUint32(offset + 16, chunk.rawBytes.byteLength, true);
    view.setUint32(offset + 20, chunk.checksum, true);
    view.setUint32(offset + 24, chunk.dependency, true);
    view.setUint32(offset + 28, chunk.compression, true);
    bytes.set(chunk.storedBytes, chunk.offset);
  });
  const directoryEnd = MORPH_ASSET_HEADER_BYTES + directoryBytes;
  view.setUint32(28, metadataChecksum(
    bytes,
    MORPH_ASSET_VERSION.minor,
    MORPH_ASSET_HEADER_BYTES,
    directoryEnd,
  ), true);
  return bytes;
}

function parseHeader(bytes, options) {
  if (bytes.byteLength < MORPH_ASSET_HEADER_BYTES) failMorphField('TRUNCATED_MORPH_HEADER', '.morph file is shorter than its 32-byte header');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const magic = utf8Decode(bytes.subarray(0, 4));
  if (magic !== MORPH_ASSET_MAGIC) failMorphField('MORPH_MAGIC_MISMATCH', `Expected ${MORPH_ASSET_MAGIC}, received ${magic}`);
  const major = view.getUint16(4, true);
  const minor = view.getUint16(6, true);
  const headerBytes = view.getUint16(8, true);
  const entryBytes = view.getUint16(10, true);
  const flags = view.getUint32(12, true);
  const chunkCount = view.getUint32(16, true);
  const directoryOffset = view.getUint32(20, true);
  const fileSize = view.getUint32(24, true);
  const headerChecksum = view.getUint32(28, true);
  if (major !== MORPH_ASSET_VERSION.major) failMorphField('MORPH_VERSION_MISMATCH', `Unsupported .morph major version ${major}`);
  if (minor > MORPH_ASSET_VERSION.minor) failMorphField('MORPH_VERSION_MISMATCH', `Unsupported .morph minor version ${minor}`);
  if (headerBytes !== MORPH_ASSET_HEADER_BYTES || entryBytes !== MORPH_ASSET_DIRECTORY_ENTRY_BYTES || directoryOffset !== MORPH_ASSET_HEADER_BYTES) {
    failMorphField('MORPH_LAYOUT_MISMATCH', '.morph header or directory stride is not the R2 32-byte layout');
  }
  if (fileSize !== bytes.byteLength) failMorphField('MORPH_FILE_LENGTH_MISMATCH', `Header declares ${fileSize} bytes, received ${bytes.byteLength}`);
  if (fileSize > maximum(options, 'MAX_FILE_BYTES')) failMorphField('MORPH_FILE_SIZE_LIMIT', '.morph file exceeds the configured file limit');
  if (chunkCount > maximum(options, 'MAX_CHUNKS')) failMorphField('MORPH_CHUNK_COUNT_LIMIT', '.morph file exceeds the configured chunk limit');
  const directoryEnd = directoryOffset + chunkCount * entryBytes;
  if (!Number.isSafeInteger(directoryEnd) || directoryEnd > bytes.byteLength) failMorphField('TRUNCATED_MORPH_DIRECTORY', '.morph directory exceeds the file');
  if (headerChecksum !== metadataChecksum(bytes, minor, directoryOffset, directoryEnd)) {
    failMorphField(
      'MORPH_HEADER_CRC_MISMATCH',
      minor >= 1 ? '.morph header/directory metadata CRC32 mismatch' : '.morph header CRC32 mismatch',
    );
  }
  if ((flags & ~MORPH_HEADER_FLAG_MASK) !== 0) {
    failMorphField('UNKNOWN_MORPH_HEADER_FLAGS', '.morph header uses unknown flag bits', { flags });
  }
  if ((flags & MORPH_HEADER_FLAG.LITTLE_ENDIAN) === 0) failMorphField('MORPH_ENDIAN_MISMATCH', '.morph file is not marked little-endian');
  return { view, major, minor, flags, chunkCount, directoryOffset, directoryEnd, fileSize };
}

function parseDirectory(bytes, header, options) {
  const entries = [];
  let totalRaw = 0;
  const chunkRawLimit = maximum(options, 'MAX_CHUNK_RAW_BYTES');
  const totalRawLimit = maximum(options, 'MAX_TOTAL_RAW_BYTES');
  const manifestLimit = maximum(options, 'MAX_MANIFEST_BYTES');
  const provenanceLimit = maximum(options, 'MAX_PROVENANCE_BYTES');
  for (let index = 0; index < header.chunkCount; index++) {
    const directoryOffset = header.directoryOffset + index * MORPH_ASSET_DIRECTORY_ENTRY_BYTES;
    const type = uint32ToFourCC(header.view.getUint32(directoryOffset, true));
    try {
      fourCCToUint32(type);
    } catch (error) {
      failMorphField('INVALID_MORPH_CHUNK_TYPE', `Directory entry ${index} has an invalid type`);
    }
    const flags = header.view.getUint32(directoryOffset + 4, true);
    const offset = header.view.getUint32(directoryOffset + 8, true);
    const storedLength = header.view.getUint32(directoryOffset + 12, true);
    const rawLength = header.view.getUint32(directoryOffset + 16, true);
    const checksum = header.view.getUint32(directoryOffset + 20, true);
    const dependency = header.view.getUint32(directoryOffset + 24, true);
    const compression = header.view.getUint32(directoryOffset + 28, true);
    validateChunkFlags(type, flags, `Directory entry ${index} (${type})`);
    if (![MORPH_COMPRESSION.NONE, MORPH_COMPRESSION.GZIP, MORPH_COMPRESSION.DEFLATE].includes(compression)) {
      failMorphField('UNKNOWN_MORPH_COMPRESSION', `Chunk ${type} uses unknown compression ${compression}`);
    }
    if (compression === MORPH_COMPRESSION.NONE && storedLength !== rawLength) {
      failMorphField('MORPH_CHUNK_LENGTH_MISMATCH', `Uncompressed chunk ${type} has unequal stored and raw lengths`);
    }
    if ((offset & 7) !== 0 || offset < align8(header.directoryEnd) || offset + storedLength > bytes.byteLength || offset + storedLength < offset) {
      failMorphField('MORPH_CHUNK_RANGE', `Chunk ${type} has an invalid or unaligned byte range`, { index, offset, storedLength });
    }
    if (rawLength > chunkRawLimit) failMorphField('MORPH_CHUNK_SIZE_LIMIT', `Chunk ${type} exceeds the raw size limit`);
    if (type === MORPH_CHUNK_TYPE.MANIFEST && rawLength > manifestLimit) {
      failMorphField('MORPH_MANIFEST_SIZE_LIMIT', 'Manifest exceeds the configured limit');
    }
    if (type === MORPH_CHUNK_TYPE.PROVENANCE && rawLength > provenanceLimit) {
      failMorphField('MORPH_PROVENANCE_SIZE_LIMIT', 'Provenance exceeds the configured limit');
    }
    if (dependency !== INVALID_DEPENDENCY && dependency >= index) {
      failMorphField('INVALID_MORPH_DEPENDENCY', `Chunk ${type} dependency must reference an earlier entry`, { index, dependency });
    }
    if (!MORPH_KNOWN_CHUNK_TYPES.includes(type) && (flags & MORPH_CHUNK_FLAG.REQUIRED) !== 0) {
      failMorphField('UNKNOWN_REQUIRED_MORPH_CHUNK', `Required chunk ${type} is not understood`);
    }
    if (MORPH_KNOWN_CHUNK_TYPES.includes(type)
        && type !== MORPH_CHUNK_TYPE.MANIFEST
        && (flags & MORPH_CHUNK_FLAG.REQUIRED) !== 0) {
      failMorphField('UNIMPLEMENTED_REQUIRED_MORPH_CHUNK', `Required ${type} chunks are not an implemented authoritative contract`);
    }
    totalRaw += rawLength;
    if (totalRaw > totalRawLimit) failMorphField('MORPH_TOTAL_RAW_SIZE_LIMIT', '.morph chunks exceed the total raw size limit');
    entries.push({ index, type, flags, offset, storedLength, rawLength, checksum, dependency, compression });
  }
  const sortedRanges = [...entries].sort((a, b) => a.offset - b.offset || a.index - b.index);
  for (let index = 1; index < sortedRanges.length; index++) {
    const previous = sortedRanges[index - 1];
    const current = sortedRanges[index];
    if (current.offset < previous.offset + previous.storedLength) {
      failMorphField('OVERLAPPING_MORPH_CHUNKS', `Chunks ${previous.type} and ${current.type} overlap`);
    }
  }
  let paddingStart = header.directoryEnd;
  for (const range of sortedRanges) {
    for (let offset = paddingStart; offset < range.offset; offset++) {
      if (bytes[offset] !== 0) {
        failMorphField('NONZERO_MORPH_PADDING', `.morph alignment padding must be zero at byte ${offset}`, { offset });
      }
    }
    paddingStart = range.offset + range.storedLength;
  }
  for (let offset = paddingStart; offset < bytes.byteLength; offset++) {
    if (bytes[offset] !== 0) {
      failMorphField('NONZERO_MORPH_PADDING', `.morph trailing alignment padding must be zero at byte ${offset}`, { offset });
    }
  }
  const manifests = entries.filter(entry => entry.type === MORPH_CHUNK_TYPE.MANIFEST);
  if (manifests.length !== 1 || manifests[0].index !== 0 || manifests[0].dependency !== INVALID_DEPENDENCY) {
    failMorphField('INVALID_MORPH_MANIFEST', '.morph requires exactly one required authoritative MANF chunk');
  }
  const provenance = entries.filter(entry => entry.type === MORPH_CHUNK_TYPE.PROVENANCE);
  if (provenance.length > 1) {
    failMorphField('DUPLICATE_MORPH_PROVENANCE', '.morph assets may contain at most one PROV chunk');
  }
  if (provenance.length === 1 && provenance[0].dependency !== manifests[0].index) {
    failMorphField('INVALID_MORPH_DEPENDENCY', 'PROV must depend on the authoritative MANF chunk');
  }
  let expectedHeaderFlags = MORPH_HEADER_FLAG.LITTLE_ENDIAN;
  if (entries.some(entry => entry.compression !== MORPH_COMPRESSION.NONE)) {
    expectedHeaderFlags |= MORPH_HEADER_FLAG.HAS_COMPRESSION;
  }
  if (provenance.length === 1) expectedHeaderFlags |= MORPH_HEADER_FLAG.HAS_PROVENANCE;
  if (header.flags !== expectedHeaderFlags) {
    failMorphField('MORPH_HEADER_FLAG_MISMATCH', '.morph header flags do not match directory contents', {
      flags: header.flags,
      expectedFlags: expectedHeaderFlags,
    });
  }
  return entries;
}

async function decodeMorphAssetBytes(bytes, options) {
  const header = parseHeader(bytes, options);
  const directory = parseDirectory(bytes, header, options);
  const chunks = [];
  const skippedChunks = [];
  for (const entry of directory) {
    const stored = bytes.subarray(entry.offset, entry.offset + entry.storedLength);
    const raw = await decompressBytes(stored, entry.compression, entry.rawLength);
    if (raw.byteLength !== entry.rawLength) {
      failMorphField('MORPH_CHUNK_LENGTH_MISMATCH', `Chunk ${entry.type} expands to ${raw.byteLength} bytes, expected ${entry.rawLength}`);
    }
    if (crc32(raw) !== entry.checksum) failMorphField('MORPH_CHUNK_CRC_MISMATCH', `Chunk ${entry.type} failed CRC32 validation`);
    if (!MORPH_KNOWN_CHUNK_TYPES.includes(entry.type)) {
      skippedChunks.push(Object.freeze({ type: entry.type, rawLength: entry.rawLength, storedLength: entry.storedLength }));
      continue;
    }
    chunks.push(Object.freeze({ ...entry, data: raw }));
  }
  const manifestChunk = chunks.find(chunk => chunk.type === MORPH_CHUNK_TYPE.MANIFEST);
  const manifestText = utf8Decode(manifestChunk.data);
  const manifest = canonicalParse(manifestText, {
    ...options.canonicalization,
    maximumLength: maximum(options, 'MAX_MANIFEST_BYTES'),
  });
  if (manifestText !== canonicalStringify(manifest, options.canonicalization)) {
    failMorphField('SCENE_CANONICAL_MISMATCH', 'MorphField MANF JSON must use its deterministic canonical encoding');
  }
  const scene = NexelScene.fromJSON(manifest, { strictCanonical: true });
  const provenanceChunk = chunks.find(chunk => chunk.type === MORPH_CHUNK_TYPE.PROVENANCE);
  const provenance = provenanceChunk
    ? parseCanonicalProvenance(provenanceChunk.data, options, 'PROV', manifest)
    : null;
  return Object.freeze({
    format: MORPH_ASSET_MAGIC,
    version: Object.freeze({ major: header.major, minor: header.minor }),
    flags: header.flags,
    scene,
    manifest,
    provenance,
    chunks: Object.freeze(chunks),
    skippedChunks: Object.freeze(skippedChunks),
  });
}

export async function decodeMorphAsset(input, options = {}) {
  const bytes = byteView(input, '.morph input', maximum(options, 'MAX_FILE_BYTES'));
  return decodeMorphAssetBytes(bytes, options);
}

async function readBoundedResponse(response, options) {
  const maximumBytes = maximum(options, 'MAX_FILE_BYTES');
  const contentLengthText = response.headers?.get?.('content-length');
  if (contentLengthText && /^\d+$/u.test(contentLengthText)) {
    const contentLength = Number(contentLengthText);
    if (!Number.isSafeInteger(contentLength) || contentLength > maximumBytes) {
      failByteLimit('.morph response', contentLength, maximumBytes);
    }
  }
  if (!response.body?.getReader) {
    try {
      const buffer = await response.arrayBuffer();
      return byteView(buffer, '.morph response', maximumBytes, false);
    } catch (error) {
      if (error instanceof MorphFieldError) throw error;
      failMorphField('MORPH_FETCH_FAILED', 'Failed while reading the .morph response body', {
        cause: String(error?.message || error),
      });
    }
  }
  let reader;
  try {
    reader = response.body.getReader();
  } catch (error) {
    failMorphField('MORPH_FETCH_FAILED', 'The .morph response body is unavailable or already locked', {
      cause: String(error?.message || error),
    });
  }
  const chunks = [];
  let totalBytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = byteView(value, '.morph response chunk', Infinity, false);
      totalBytes += chunk.byteLength;
      if (!Number.isSafeInteger(totalBytes) || totalBytes > maximumBytes) {
        try { await reader.cancel('MorphField .morph response size limit exceeded'); } catch (_) { /* best effort */ }
        failByteLimit('.morph response', totalBytes, maximumBytes);
      }
      chunks.push(new Uint8Array(chunk));
    }
  } catch (error) {
    if (error instanceof MorphFieldError) throw error;
    failMorphField('MORPH_FETCH_FAILED', 'Failed while reading the .morph response body', {
      cause: String(error?.message || error),
    });
  }
  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

async function decodeResponse(response, options) {
  if (!response.ok) {
    failMorphField('MORPH_FETCH_FAILED', `Failed to load .morph asset: HTTP ${response.status}`, {
      status: response.status,
    });
  }
  return decodeMorphAssetBytes(await readBoundedResponse(response, options), options);
}

export async function loadMorphAsset(source, options = {}) {
  const isUrl = typeof URL === 'function' && source instanceof URL;
  const isRequest = typeof Request === 'function' && source instanceof Request;
  if (typeof source === 'string' || isUrl || isRequest) {
    let response;
    try {
      response = await fetch(source, options.fetch);
    } catch (error) {
      failMorphField('MORPH_FETCH_FAILED', 'Failed to fetch .morph asset', {
        cause: String(error?.message || error),
      });
    }
    return decodeResponse(response, options);
  }
  if (typeof Response === 'function' && source instanceof Response) {
    return decodeResponse(source, options);
  }
  if (typeof Blob === 'function' && source instanceof Blob) {
    const maximumBytes = maximum(options, 'MAX_FILE_BYTES');
    if (source.size > maximumBytes) failByteLimit('.morph Blob', source.size, maximumBytes);
    return decodeMorphAssetBytes(byteView(await source.arrayBuffer(), '.morph Blob', maximumBytes, false), options);
  }
  return decodeMorphAsset(source, options);
}

export const writeMorphAsset = encodeMorphAsset;
