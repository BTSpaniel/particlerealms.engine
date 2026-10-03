// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

import { MAX_CHUNK_BYTES } from './ChunkLimits.js';

const HASH_RE = /^[0-9a-f]{64}$/;

/** Bounded in-memory LRU used only while the browser endpoint is alive. */
export function createChunkCache({ maxEntries = 128, maxBytes = 64 * 1024 * 1024 } = {}) {
  if (!Number.isSafeInteger(maxEntries) || maxEntries < 1 || maxEntries > 4096) throw new RangeError('chunk cache maxEntries is invalid');
  if (!Number.isSafeInteger(maxBytes) || maxBytes < MAX_CHUNK_BYTES || maxBytes > 1024 * 1024 * 1024) {
    throw new RangeError('chunk cache maxBytes is invalid');
  }
  return { entries: new Map(), bytes: 0, maxEntries, maxBytes, hits: 0, misses: 0, evictions: 0 };
}

/** Store bytes that the caller has already content/Merkle verified. */
export function cacheVerifiedChunk(cache, { chunkId, fragmentRoot, bytes } = {}) {
  if (!HASH_RE.test(chunkId) || !HASH_RE.test(fragmentRoot)) throw new TypeError('cached chunk hashes are invalid');
  if (!(bytes instanceof Uint8Array) || bytes.byteLength > MAX_CHUNK_BYTES) throw new TypeError('cached chunk bytes are invalid');
  const copy = new Uint8Array(bytes);
  const existing = cache.entries.get(chunkId);
  if (existing) cache.bytes -= existing.bytes.byteLength;
  cache.entries.delete(chunkId);
  cache.entries.set(chunkId, { chunkId, fragmentRoot, bytes: copy, storedAt: Date.now() });
  cache.bytes += copy.byteLength;
  while (cache.entries.size > cache.maxEntries || cache.bytes > cache.maxBytes) {
    const oldestId = cache.entries.keys().next().value;
    const oldest = cache.entries.get(oldestId);
    cache.entries.delete(oldestId);
    cache.bytes -= oldest.bytes.byteLength;
    cache.evictions += 1;
  }
  return cache.entries.has(chunkId);
}

export function readCachedChunk(cache, chunkId) {
  const entry = cache.entries.get(chunkId);
  if (!entry) {
    cache.misses += 1;
    return null;
  }
  cache.entries.delete(chunkId);
  cache.entries.set(chunkId, entry);
  cache.hits += 1;
  return entry;
}

export function chunkCacheStatus(cache) {
  return Object.freeze({
    entries: cache.entries.size,
    bytes: cache.bytes,
    maxEntries: cache.maxEntries,
    maxBytes: cache.maxBytes,
    hits: cache.hits,
    misses: cache.misses,
    evictions: cache.evictions,
  });
}
