// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

// network/chunks/DedupeCache.js — generic seen-packet dedupe table (network
// plan §29), keyed by whatever content/event/packet hash a caller chooses.
// Type-specific retention: callers pick the ttlMs per dedupe key type
// (control packets 1-5min, route announcements 5-30min, chunks/ledger
// events effectively forever via their own content hash, etc.) — this
// module just enforces "seen within its TTL -> drop" generically.

/** Create an empty dedupe cache. */
export function createDedupeCache() {
  return { _seen: new Map() }; // key -> expiresAt (ms epoch)
}

/** True if `key` was marked seen and its TTL hasn't expired yet. Expired entries are lazily evicted. */
export function hasSeen(cache, key, now = Date.now()) {
  const expiresAt = cache._seen.get(key);
  if (expiresAt == null) return false;
  if (now > expiresAt) { cache._seen.delete(key); return false; }
  return true;
}

/** Mark `key` as seen for `ttlMs` milliseconds. */
export function markSeen(cache, key, ttlMs, now = Date.now()) {
  cache._seen.set(key, now + ttlMs);
}

/**
 * Convenience: check-and-mark in one call — the usual receive-path pattern
 * ("if already seen, drop; otherwise mark seen and process").
 * @returns {boolean} true if this is a NEW key (caller should process it)
 */
export function checkAndMark(cache, key, ttlMs, now = Date.now()) {
  if (hasSeen(cache, key, now)) return false;
  markSeen(cache, key, ttlMs, now);
  return true;
}

/** Remove all expired entries. Returns the number removed. */
export function pruneDedupeCache(cache, now = Date.now()) {
  let removed = 0;
  for (const [key, expiresAt] of cache._seen) {
    if (expiresAt <= now) { cache._seen.delete(key); removed++; }
  }
  return removed;
}

export function dedupeCacheSize(cache) {
  return cache._seen.size;
}
