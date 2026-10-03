// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

import { crc32 } from '../../../core/math/ChecksumMath.js';
import { createNexelScene } from '../core/NexelScene.js';
import { canonicalParse, canonicalStringify } from '../core/serialization.js';
import { decodeMorphAsset, encodeMorphAsset, loadMorphAsset } from './MorphAssetCodec.js';
import {
  MORPH_ASSET_DIRECTORY_ENTRY_BYTES,
  MORPH_ASSET_HEADER_BYTES,
  MORPH_ASSET_VERSION,
  MORPH_CHUNK_FLAG,
  MORPH_HEADER_FLAG,
} from './MorphAssetFormat.js';

function assert(condition, message) {
  if (!condition) throw new Error(`.morph codec self-test failed: ${message}`);
}

function equalBytes(a, b) {
  return a.byteLength === b.byteLength && a.every((value, index) => value === b[index]);
}

async function expectCode(operation, code, message) {
  let received = null;
  try {
    await operation();
  } catch (error) {
    received = error?.code || error?.name || 'unknown';
  }
  assert(received === code, `${message}; expected ${code}, received ${received}`);
}

async function expectFailure(operation, message) {
  let rejected = false;
  try {
    await operation();
  } catch {
    rejected = true;
  }
  assert(rejected, message);
}

function seededOffsets(length, count, seed = 0x4d4f5232) {
  let state = seed >>> 0;
  const offsets = new Set([0, Math.max(0, length - 1)]);
  while (offsets.size < Math.min(length, count)) {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    offsets.add((state >>> 0) % length);
  }
  return [...offsets].sort((left, right) => left - right);
}

function refreshMetadataChecksum(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const minor = view.getUint16(6, true);
  const directoryOffset = view.getUint32(20, true);
  const directoryEnd = directoryOffset
    + view.getUint32(16, true) * view.getUint16(10, true);
  let checksum = crc32(bytes.subarray(0, 28));
  if (minor >= 1) checksum = crc32(bytes.subarray(directoryOffset, directoryEnd), checksum);
  view.setUint32(28, checksum, true);
}

function findAscii(bytes, text, start, end) {
  const needle = new TextEncoder().encode(text);
  for (let offset = start; offset + needle.length <= end; offset++) {
    let match = true;
    for (let index = 0; index < needle.length; index++) {
      if (bytes[offset + index] !== needle[index]) {
        match = false;
        break;
      }
    }
    if (match) return offset;
  }
  return -1;
}

export async function runMorphAssetSelfTests() {
  const passed = [];
  const scene = createNexelScene({ id: 'asset-self-test' });
  scene.upsert({ id: 'sphere', source: { kind: 'sphere', radius: 1 } });
  const options = {
    compression: 'none',
    provenance: {
      author: 'MorphField self-test',
      date: '2026-07-17',
      scene: 'asset-self-test',
      sourceRevision: 1,
    },
    chunks: [{ type: 'BINA', data: new Uint8Array([1, 2, 3, 4]), disposable: true, dependsOn: 'MANF' }],
  };
  const first = await encodeMorphAsset(scene, options);
  const second = await encodeMorphAsset(scene, options);
  assert(equalBytes(first, second), 'uncompressed encoding is byte-for-byte deterministic');
  const view = new DataView(first.buffer, first.byteOffset, first.byteLength);
  assert(view.getUint16(8, true) === MORPH_ASSET_HEADER_BYTES, 'header is exactly 32 bytes');
  assert(view.getUint16(10, true) === MORPH_ASSET_DIRECTORY_ENTRY_BYTES, 'directory entries are exactly 32 bytes');
  assert(view.getUint16(6, true) === MORPH_ASSET_VERSION.minor, 'encoder emits the current MOR2 minor revision');
  const decoded = await decodeMorphAsset(first);
  assert(decoded.scene.serialize() === scene.serialize(), 'semantic scene round-trips exactly');
  assert(decoded.provenance.author === 'MorphField self-test'
      && decoded.provenance.schema === 'morphfield-asset-provenance'
      && decoded.provenance.version === 1
      && decoded.provenance.scene === scene.id
      && decoded.provenance.sourceRevision === scene.revision
      && decoded.provenance.$schema.endsWith('/provenance.schema.json'),
    'versioned provenance round-trips');
  assert(decoded.chunks.some(chunk => chunk.type === 'BINA' && chunk.data[3] === 4), 'binary chunk round-trips');
  passed.push('deterministic little-endian container and semantic/binary round-trip');

  const corruptHeader = new Uint8Array(first);
  corruptHeader[12] ^= 1;
  let headerRejected = false;
  try {
    await decodeMorphAsset(corruptHeader);
  } catch (error) {
    headerRejected = error?.code === 'MORPH_HEADER_CRC_MISMATCH';
  }
  assert(headerRejected, 'header corruption is rejected by CRC32');
  const corruptChunk = new Uint8Array(first);
  const manifestOffset = view.getUint32(MORPH_ASSET_HEADER_BYTES + 8, true);
  corruptChunk[manifestOffset] ^= 1;
  let chunkRejected = false;
  try {
    await decodeMorphAsset(corruptChunk);
  } catch (error) {
    chunkRejected = error?.code === 'MORPH_CHUNK_CRC_MISMATCH';
  }
  assert(chunkRejected, 'chunk corruption is rejected by CRC32');
  passed.push('header and chunk corruption rejection');

  const mutationOffsets = seededOffsets(first.byteLength, 32);
  for (let index = 0; index < mutationOffsets.length; index++) {
    const mutated = new Uint8Array(first);
    mutated[mutationOffsets[index]] ^= 1 << (index & 7);
    await expectFailure(
      () => decodeMorphAsset(mutated),
      `seeded mutation ${index} at byte ${mutationOffsets[index]} bypassed integrity validation`,
    );
  }
  passed.push(`${mutationOffsets.length} seeded whole-container integrity mutations`);

  const corruptDirectory = new Uint8Array(first);
  corruptDirectory[MORPH_ASSET_HEADER_BYTES + 12] ^= 1;
  await expectCode(
    () => decodeMorphAsset(corruptDirectory),
    'MORPH_HEADER_CRC_MISMATCH',
    'minor-1 protects directory metadata before any payload is trusted',
  );
  const legacyMinorZero = new Uint8Array(first);
  const legacyView = new DataView(legacyMinorZero.buffer);
  legacyView.setUint16(6, 0, true);
  legacyView.setUint32(28, crc32(legacyMinorZero.subarray(0, 28)), true);
  const legacyDecoded = await decodeMorphAsset(legacyMinorZero);
  assert(legacyDecoded.version.minor === 0, 'minor-0 assets remain readable');
  passed.push('minor-1 directory integrity and minor-0 compatibility');

  const canonicalProto = canonicalParse('{"safe":1,"__proto__":{"polluted":true}}');
  assert(Object.getPrototypeOf(canonicalProto) === Object.prototype, 'canonical objects retain the ordinary safe prototype');
  assert(Object.prototype.hasOwnProperty.call(canonicalProto, '__proto__'), '__proto__ is preserved as an own data property');
  assert(({}).polluted === undefined, '__proto__ input does not pollute Object.prototype');
  assert(canonicalStringify(canonicalProto).includes('"__proto__"'), '__proto__ survives deterministic serialization');
  await expectCode(
    () => canonicalParse(`${'['.repeat(10)}0${']'.repeat(10)}`, { maximumDepth: 8 }),
    'JSON_DEPTH_LIMIT',
    'canonical JSON depth is bounded before recursion can exhaust the stack',
  );
  await expectCode(
    () => canonicalParse('[1,2,3]', { maximumNodes: 2 }),
    'JSON_NODE_LIMIT',
    'canonical JSON node count is bounded',
  );
  passed.push('bounded canonical JSON and prototype-safe key handling');

  const nonCanonicalManifest = new Uint8Array(first);
  const nonCanonicalView = new DataView(nonCanonicalManifest.buffer);
  const manifestDirectory = MORPH_ASSET_HEADER_BYTES;
  const nonCanonicalManifestOffset = nonCanonicalView.getUint32(manifestDirectory + 8, true);
  const manifestLength = nonCanonicalView.getUint32(manifestDirectory + 16, true);
  const unitsKey = findAscii(
    nonCanonicalManifest,
    '"units"',
    nonCanonicalManifestOffset,
    nonCanonicalManifestOffset + manifestLength,
  );
  assert(unitsKey >= 0, 'fixture contains canonical units key');
  nonCanonicalManifest.set(new TextEncoder().encode('"bogus"'), unitsKey);
  nonCanonicalView.setUint32(
    manifestDirectory + 20,
    crc32(nonCanonicalManifest.subarray(
      nonCanonicalManifestOffset,
      nonCanonicalManifestOffset + manifestLength,
    )),
    true,
  );
  refreshMetadataChecksum(nonCanonicalManifest);
  await expectCode(
    () => decodeMorphAsset(nonCanonicalManifest),
    'SCENE_CANONICAL_MISMATCH',
    'MANF rejects unknown or default-dependent semantic fields even with valid checksums',
  );
  passed.push('strict canonical MANF envelope');

  await expectCode(
    () => encodeMorphAsset(scene, {
      compression: 'none',
      provenance: { source: 'one' },
      chunks: [{ type: 'PROV', data: '{"source":"two"}', json: true }],
    }),
    'DUPLICATE_MORPH_PROVENANCE',
    'encoder rejects duplicate provenance',
  );
  await expectCode(
    () => encodeMorphAsset(scene, {
      compression: 'none',
      chunks: [{ type: 'PROV', data: '{ "source": "noncanonical" }', json: true }],
    }),
    'PROVENANCE_CANONICAL_MISMATCH',
    'raw PROV chunks must use canonical JSON before publication',
  );
  await expectCode(
    () => encodeMorphAsset(scene, {
      compression: 'none',
      provenance: ['arrays-are-not-provenance-records'],
    }),
    'INVALID_MORPH_PROVENANCE',
    'PROV payloads are versioned JSON objects rather than arbitrary roots',
  );
  for (const [provenance, code, label] of [
    [{ author: 7 }, 'INVALID_MORPH_PROVENANCE', 'typed author'],
    [{ date: '2026-02-30' }, 'INVALID_MORPH_PROVENANCE', 'real calendar date'],
    [{ sourceRevision: 1.5 }, 'INVALID_MORPH_PROVENANCE', 'safe integer revision'],
    [{ scene: 'different-scene' }, 'MORPH_PROVENANCE_SCENE_MISMATCH', 'manifest scene binding'],
    [{ sourceRevision: scene.revision + 1 }, 'MORPH_PROVENANCE_REVISION_MISMATCH', 'manifest revision binding'],
    [{ records: new Array(4097).fill(null) }, 'INVALID_MORPH_PROVENANCE', 'bounded records'],
  ]) {
    await expectCode(
      () => encodeMorphAsset(scene, { compression: 'none', provenance }),
      code,
      `PROV enforces its ${label}`,
    );
  }
  await expectCode(
    () => encodeMorphAsset(scene, {
      compression: 'none',
      chunks: [{ type: 'ZZZZ', data: new Uint8Array(), flags: MORPH_CHUNK_FLAG.REQUIRED }],
    }),
    'UNKNOWN_REQUIRED_MORPH_CHUNK',
    'effective REQUIRED flags are enforced for unknown chunks',
  );
  const unknownOptional = await encodeMorphAsset(scene, {
    compression: 'none',
    chunks: [{ type: 'ZZZZ', data: new Uint8Array([9, 8, 7, 6]) }],
  });
  const unknownOptionalDecoded = await decodeMorphAsset(unknownOptional);
  assert(unknownOptionalDecoded.skippedChunks.some(chunk => chunk.type === 'ZZZZ'),
    'unknown optional chunks are not reported as safely skipped');
  const corruptUnknownOptional = new Uint8Array(unknownOptional);
  const corruptUnknownView = new DataView(corruptUnknownOptional.buffer);
  const unknownPayloadOffset = corruptUnknownView.getUint32(
    MORPH_ASSET_HEADER_BYTES + MORPH_ASSET_DIRECTORY_ENTRY_BYTES + 8,
    true,
  );
  corruptUnknownOptional[unknownPayloadOffset] ^= 1;
  await expectCode(
    () => decodeMorphAsset(corruptUnknownOptional),
    'MORPH_CHUNK_CRC_MISMATCH',
    'unknown optional chunks still require valid length, decompression, and CRC before they are skipped',
  );
  await expectCode(
    () => encodeMorphAsset(scene, {
      compression: 'none',
      chunks: [{ type: 'CERT', data: new Uint8Array(), flags: MORPH_CHUNK_FLAG.REQUIRED }],
    }),
    'UNIMPLEMENTED_REQUIRED_MORPH_CHUNK',
    'recognized opaque chunks cannot claim required semantics before an ABI parser exists',
  );
  await expectCode(
    () => encodeMorphAsset(scene, {
      compression: 'none',
      chunks: [{ type: 'BINA', data: new Uint8Array(), flags: 0x80000000 }],
    }),
    'UNKNOWN_MORPH_CHUNK_FLAGS',
    'encoder rejects unknown chunk flag bits',
  );
  const unknownDirectoryFlags = new Uint8Array(first);
  const unknownDirectoryView = new DataView(unknownDirectoryFlags.buffer);
  unknownDirectoryView.setUint32(
    MORPH_ASSET_HEADER_BYTES + 4,
    unknownDirectoryView.getUint32(MORPH_ASSET_HEADER_BYTES + 4, true) | 0x80000000,
    true,
  );
  refreshMetadataChecksum(unknownDirectoryFlags);
  await expectCode(
    () => decodeMorphAsset(unknownDirectoryFlags),
    'UNKNOWN_MORPH_CHUNK_FLAGS',
    'decoder rejects unknown chunk flag bits after metadata integrity passes',
  );
  const contradictoryDirectoryFlags = new Uint8Array(first);
  const contradictoryDirectoryView = new DataView(contradictoryDirectoryFlags.buffer);
  const binaryFlagsOffset = MORPH_ASSET_HEADER_BYTES + 2 * MORPH_ASSET_DIRECTORY_ENTRY_BYTES + 4;
  contradictoryDirectoryView.setUint32(
    binaryFlagsOffset,
    contradictoryDirectoryView.getUint32(binaryFlagsOffset, true) | MORPH_CHUNK_FLAG.AUTHORITATIVE,
    true,
  );
  refreshMetadataChecksum(contradictoryDirectoryFlags);
  await expectCode(
    () => decodeMorphAsset(contradictoryDirectoryFlags),
    'INVALID_MORPH_CHUNK_FLAGS',
    'decoder rejects authoritative/disposable contradictions',
  );
  await expectCode(
    () => decodeMorphAsset(first, { limits: { MAX_PROVENANCE_BYTES: 1 } }),
    'MORPH_PROVENANCE_SIZE_LIMIT',
    'PROV has an independent raw-size bound',
  );
  const mismatchedHeaderFlags = new Uint8Array(first);
  const mismatchedHeaderView = new DataView(mismatchedHeaderFlags.buffer);
  mismatchedHeaderView.setUint32(12, mismatchedHeaderView.getUint32(12, true) | MORPH_HEADER_FLAG.HAS_COMPRESSION, true);
  refreshMetadataChecksum(mismatchedHeaderFlags);
  await expectCode(
    () => decodeMorphAsset(mismatchedHeaderFlags),
    'MORPH_HEADER_FLAG_MISMATCH',
    'header capability flags must agree with the directory',
  );
  const unknownHeaderFlags = new Uint8Array(first);
  const unknownHeaderView = new DataView(unknownHeaderFlags.buffer);
  unknownHeaderView.setUint32(12, unknownHeaderView.getUint32(12, true) | 0x80000000, true);
  refreshMetadataChecksum(unknownHeaderFlags);
  await expectCode(
    () => decodeMorphAsset(unknownHeaderFlags),
    'UNKNOWN_MORPH_HEADER_FLAGS',
    'decoder rejects unknown header flag bits',
  );
  passed.push('single bounded PROV and effective/header flag validation');

  const tooSmallFileLimit = first.byteLength - 1;
  await expectCode(
    () => decodeMorphAsset(first, { limits: { MAX_FILE_BYTES: tooSmallFileLimit } }),
    'MORPH_FILE_SIZE_LIMIT',
    'direct byte inputs are bounded before a defensive copy',
  );
  if (typeof Blob === 'function') {
    await expectCode(
      () => loadMorphAsset(new Blob([first]), { limits: { MAX_FILE_BYTES: tooSmallFileLimit } }),
      'MORPH_FILE_SIZE_LIMIT',
      'Blob size is bounded before arrayBuffer allocation',
    );
  }
  if (typeof Response === 'function') {
    const response = new Response(first, { headers: { 'content-length': String(first.byteLength) } });
    await expectCode(
      () => loadMorphAsset(response, { limits: { MAX_FILE_BYTES: tooSmallFileLimit } }),
      'MORPH_FILE_SIZE_LIMIT',
      'Response Content-Length is bounded before body allocation',
    );
    if (typeof ReadableStream === 'function') {
      let streamCancelled = false;
      const streamedResponse = new Response(new ReadableStream({
        start(controller) {
          controller.enqueue(first.subarray(0, Math.ceil(first.byteLength / 2)));
          controller.enqueue(first.subarray(Math.ceil(first.byteLength / 2)));
        },
        cancel() {
          streamCancelled = true;
        },
      }));
      await expectCode(
        () => loadMorphAsset(streamedResponse, { limits: { MAX_FILE_BYTES: tooSmallFileLimit } }),
        'MORPH_FILE_SIZE_LIMIT',
        'chunked Response bodies are stopped at the configured cap',
      );
      assert(streamCancelled, 'oversized streaming Response is cancelled');
    }
  }
  passed.push('early bounded byte, Blob, and Response loading');

  if (typeof globalThis.CompressionStream === 'function' && typeof globalThis.DecompressionStream === 'function') {
    for (const compression of ['gzip', 'deflate']) {
      const compressed = await encodeMorphAsset(scene, { compression, compressionThreshold: 0 });
      const roundTrip = await decodeMorphAsset(compressed);
      assert(roundTrip.scene.serialize() === scene.serialize(), `${compression} round-trip preserves the semantic scene`);
    }
    passed.push('gzip and deflate capability paths');
  }
  return Object.freeze({ passed: true, count: passed.length, checks: Object.freeze(passed) });
}
