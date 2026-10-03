// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

// network/chunks/ChunkFragmenter.js — split large objects into chunks, and
// chunks into transport-sized fragments (network plan §27/§31/§32).

import { MAX_CHUNK_BYTES, DEFAULT_CHUNK_BYTES, DEFAULT_FRAGMENT_BYTES } from './ChunkLimits.js';

/**
 * Split an object's bytes into chunks no larger than `chunkSize` (which must
 * not exceed the network-wide 4MB ceiling).
 * @param {Uint8Array} bytes
 * @param {number} [chunkSize]
 * @returns {Uint8Array[]}
 */
export function splitIntoChunks(bytes, chunkSize = DEFAULT_CHUNK_BYTES) {
  if (chunkSize > MAX_CHUNK_BYTES) throw new RangeError(`chunkSize ${chunkSize} exceeds MAX_CHUNK_BYTES ${MAX_CHUNK_BYTES}`);
  if (chunkSize <= 0) throw new RangeError('chunkSize must be > 0');
  const chunks = [];
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    chunks.push(bytes.subarray(offset, Math.min(offset + chunkSize, bytes.length)));
  }
  if (chunks.length === 0) chunks.push(bytes.subarray(0, 0)); // preserve "0-byte object -> 1 empty chunk"
  return chunks;
}

/**
 * Split one chunk's bytes into transport-sized fragments.
 * @param {Uint8Array} chunkBytes
 * @param {number} [fragmentSize]
 * @returns {Uint8Array[]}
 */
export function splitChunkIntoFragments(chunkBytes, fragmentSize = DEFAULT_FRAGMENT_BYTES) {
  if (fragmentSize <= 0) throw new RangeError('fragmentSize must be > 0');
  const fragments = [];
  for (let offset = 0; offset < chunkBytes.length; offset += fragmentSize) {
    fragments.push(chunkBytes.subarray(offset, Math.min(offset + fragmentSize, chunkBytes.length)));
  }
  if (fragments.length === 0) fragments.push(chunkBytes.subarray(0, 0));
  return fragments;
}

/** Concatenate fragments back into one chunk's bytes. */
export function reassembleFragments(fragments) {
  const total = fragments.reduce((n, f) => n + f.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const f of fragments) { out.set(f, offset); offset += f.length; }
  return out;
}

/** Concatenate chunks back into the full object's bytes. */
export function reassembleChunks(chunks) {
  return reassembleFragments(chunks);
}
