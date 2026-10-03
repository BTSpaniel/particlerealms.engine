// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

// network/dht/DhtNode.js — a local Particle DHT node view (network plan §47,
// low priority/future). Combines a ProviderStore with a lightweight known-
// peers registry and answers FIND_PEER/FIND_ROUTE/FIND_PROVIDERS queries
// from LOCAL knowledge only — this phase delivers the data structures and
// message-handling logic; real gossip/replication across a live DHT
// transport is deferred (network plan §47: "still needs bootstrap" even
// once a real DHT exists — see BootstrapSource.js).

import { createProviderStore, announceProvider, findProviders, providersMapFor, pruneProviderStore } from './ProviderStore.js';

/** Create a local DHT node view. */
export function createDhtNode({ selfPeerId } = {}) {
  return {
    selfPeerId: selfPeerId ?? null,
    providers: createProviderStore(),
    knownPeers: new Map(), // peerId -> { lastSeen, routeHints:string[] }
  };
}

/** Record/refresh knowledge of a peer (from PEER_EXCHANGE or any direct contact). */
export function rememberPeer(node, peerId, { routeHints = [], reportedBy = null, direct = false } = {}, now = Date.now()) {
  if (typeof peerId !== 'string' || !peerId || peerId.length > 512) throw new TypeError('rememberPeer requires a bounded peerId');
  const hints = Array.isArray(routeHints) ? routeHints.filter((hint) => typeof hint === 'string' && hint.length > 0).slice(0, 32) : [];
  const existing = node.knownPeers.get(peerId);
  // A third-party exchange cannot overwrite fresher, directly-observed route
  // evidence for a peer. Direct observations can always refresh it.
  if (existing?.direct && !direct) {
    existing.lastSeen = Math.max(existing.lastSeen, now);
    return;
  }
  if (existing?.direct && direct) {
    existing.lastSeen = Math.max(existing.lastSeen, now);
    existing.routeHints = [...new Set([...existing.routeHints, ...hints])].slice(0, 32);
    existing.reportedBy = peerId;
    return;
  }
  node.knownPeers.set(peerId, {
    lastSeen: now,
    routeHints: [...new Set(hints)],
    reportedBy: direct ? peerId : (reportedBy ?? null),
    direct: !!direct,
  });
}

/** Answer a local FIND_PEER query: do we know this peer, and if so, its route hints? */
export function handleFindPeer(node, targetPeerId) {
  const known = node.knownPeers.get(targetPeerId);
  return known
    ? { found: true, routeHints: [...known.routeHints], direct: !!known.direct, reportedBy: known.reportedBy ?? null }
    : { found: false, routeHints: [], direct: false, reportedBy: null };
}

/** Answer a local FIND_ROUTE query: any peers providing this route? */
export function handleFindRoute(node, routeId, now = Date.now()) {
  return findProviders(node.providers, routeId, now);
}

/** Answer a local FIND_PROVIDERS query for an arbitrary key (chunk hash, service name, ...). */
export function handleFindProviders(node, key, now = Date.now()) {
  return findProviders(node.providers, key, now);
}

/** Ingest an ANNOUNCE_PROVIDER (route or generic key -> peer). */
export function handleAnnounceProvider(node, { key, peerId, ttlMs } = {}, now = Date.now()) {
  announceProvider(node.providers, key, peerId, ttlMs, now);
}

/** Ingest a PEER_EXCHANGE payload (array of `{peerId, routeHints}`). */
export function handlePeerExchange(node, knownPeers = [], now = Date.now(), { reportedBy = null } = {}) {
  for (const p of knownPeers) {
    if (p && p.peerId) rememberPeer(node, p.peerId, { routeHints: p.routeHints, reportedBy, direct: false }, now);
  }
}

/** Bounded peer summaries for authenticated PEER_EXCHANGE messages. */
export function listKnownPeers(node, { limit = 64 } = {}) {
  if (!Number.isSafeInteger(limit) || limit < 0 || limit > 256) throw new RangeError('peer exchange limit must be 0..256');
  return [...node.knownPeers.entries()]
    .sort((a, b) => b[1].lastSeen - a[1].lastSeen || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([peerId, info]) => ({ peerId, routeHints: [...info.routeHints] }));
}

/** Build the providers map SwarmScheduler.planSwarmFetch expects for a list of keys. */
export function providersMapForKeys(node, keys, now = Date.now()) {
  return providersMapFor(node.providers, keys, now);
}

/** Prune expired provider records and stale peer knowledge. */
export function pruneDhtNode(node, { peerStaleMs = 30 * 60 * 1000 } = {}, now = Date.now()) {
  const removedProviders = pruneProviderStore(node.providers, now);
  let removedPeers = 0;
  for (const [peerId, info] of node.knownPeers) {
    if (now - info.lastSeen > peerStaleMs) { node.knownPeers.delete(peerId); removedPeers++; }
  }
  return { removedProviders, removedPeers };
}
