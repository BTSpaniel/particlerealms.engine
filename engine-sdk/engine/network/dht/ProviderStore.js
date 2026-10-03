// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

// network/dht/ProviderStore.js — local view of "who provides what" (network
// plan §47 DHT objects: network_id -> route providers, manifest_hash ->
// chunk providers, group_alias -> route hints, service_name -> providers).
// This is a LOCAL cache only — no network gossip/replication yet (that's
// the deferred real-DHT transport); it's what a future DHT node would
// populate from FIND_PROVIDERS/ANNOUNCE_PROVIDER traffic, and what
// SwarmScheduler.js (Phase 7) already consumes as its `providers` map.

/** Create an empty provider store. */
export function createProviderStore() {
  return { _records: new Map() }; // key -> Map<peerId, expiresAt>
}

export const DEFAULT_PROVIDER_TTL_MS = 5 * 60 * 1000;
export const MAX_PROVIDER_TTL_MS = 30 * 60 * 1000;

/** Announce that `peerId` provides `key` (e.g. a manifest chunk hash, route id, service name). */
export function announceProvider(store, key, peerId, ttlMs = DEFAULT_PROVIDER_TTL_MS, now = Date.now()) {
  if (typeof key !== 'string' || !key || key.length > 2048) throw new TypeError('provider key must be a bounded string');
  if (typeof peerId !== 'string' || !peerId || peerId.length > 512) throw new TypeError('provider peerId must be a bounded string');
  if (!Number.isFinite(ttlMs) || ttlMs <= 0 || ttlMs > MAX_PROVIDER_TTL_MS) {
    throw new RangeError(`provider ttlMs must be 1..${MAX_PROVIDER_TTL_MS}`);
  }
  if (!Number.isFinite(now)) throw new TypeError('provider announcement time must be finite');
  if (!store._records.has(key)) store._records.set(key, new Map());
  store._records.get(key).set(peerId, now + ttlMs);
}

/** Remove one provider's record for a key. */
export function revokeProvider(store, key, peerId) {
  const peers = store._records.get(key);
  if (!peers) return false;
  const had = peers.delete(peerId);
  if (peers.size === 0) store._records.delete(key);
  return had;
}

/** Live (non-expired) provider peerIds for a key, or []. */
export function findProviders(store, key, now = Date.now()) {
  const peers = store._records.get(key);
  if (!peers) return [];
  const live = [];
  for (const [peerId, expiresAt] of peers) {
    if (expiresAt > now) live.push(peerId);
  }
  return live;
}

/** Build the `Map<key, peerId[]>` shape SwarmScheduler.planSwarmFetch expects, for a set of keys. */
export function providersMapFor(store, keys, now = Date.now()) {
  const map = new Map();
  for (const key of keys) map.set(key, findProviders(store, key, now));
  return map;
}

/** Remove all expired provider records. Returns the number of (key, peerId) pairs removed. */
export function pruneProviderStore(store, now = Date.now()) {
  let removed = 0;
  for (const [key, peers] of store._records) {
    for (const [peerId, expiresAt] of peers) {
      if (expiresAt <= now) { peers.delete(peerId); removed++; }
    }
    if (peers.size === 0) store._records.delete(key);
  }
  return removed;
}
