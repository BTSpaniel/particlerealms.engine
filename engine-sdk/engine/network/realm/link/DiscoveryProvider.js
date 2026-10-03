// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

// Realm discovery is an orchestration contract, not a new discovery network.
// Providers adapt the existing bootstrap, DHT, invite, contact, peer-ticket,
// and Masterserver mechanisms into one bounded result shape.

import { runBootstrap, flattenBootstrapResults } from '../../dht/BootstrapSource.js';
import {
  findPeerOverNetwork,
  findRouteOverNetwork,
  findProvidersOverNetwork,
} from '../../dht/DhtTransport.js';
import { listPeerTicketsByFreshness } from '../../peerTickets/PeerTicketStore.js';

export const DISCOVERY_KIND = Object.freeze({
  PEER_TICKET: 'peer-ticket',
  BOOTSTRAP: 'bootstrap',
  DHT: 'dht',
  INVITE: 'invite',
  CONTACT: 'contact',
  MASTER_SERVER: 'masterserver',
  LAN: 'lan',
  CUSTOM: 'custom',
});

const MAX_RESULTS_PER_PROVIDER = 256;
const MAX_ROUTE_HINTS = 32;
const MAX_TRANSPORT_HINTS = 16;
const MAX_CAPABILITIES = 64;

function boundedStrings(values, limit, label) {
  if (!Array.isArray(values)) return [];
  if (values.length > limit) throw new RangeError(`${label} exceeds ${limit} entries`);
  const result = [];
  for (const value of values) {
    if (typeof value !== 'string' || value.length === 0 || value.length > 512) {
      throw new TypeError(`${label} must contain non-empty bounded strings`);
    }
    if (!result.includes(value)) result.push(value);
  }
  return result;
}

function emit(registry, event, details = {}, level = 'debug') {
  registry.logger({
    component: 'realm-discovery',
    event,
    level,
    at: registry.now(),
    correlationId: details.correlationId ?? null,
    ...details,
  });
}

/** Normalize an untrusted provider result into the Realm discovery shape. */
export function normalizeDiscoveryCandidate(candidate, { sourceId, now = Date.now() } = {}) {
  if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
    throw new TypeError('discovery candidate must be an object');
  }
  const peerId = String(candidate.peerId ?? '').trim();
  if (!peerId || peerId.length > 512) throw new TypeError('discovery candidate requires a bounded peerId');
  const expiresAt = candidate.expiresAt == null ? null : Number(candidate.expiresAt);
  if (expiresAt != null && (!Number.isFinite(expiresAt) || expiresAt <= now)) {
    throw new RangeError('discovery candidate is expired or has an invalid expiresAt');
  }
  return Object.freeze({
    peerId,
    sourceIds: Object.freeze([String(sourceId ?? candidate.sourceId ?? 'unknown')]),
    routeHints: Object.freeze(boundedStrings(candidate.routeHints, MAX_ROUTE_HINTS, 'routeHints')),
    transportHints: Object.freeze(boundedStrings(candidate.transportHints, MAX_TRANSPORT_HINTS, 'transportHints')),
    capabilities: Object.freeze(boundedStrings(candidate.capabilities, MAX_CAPABILITIES, 'capabilities')),
    observedAt: Number.isFinite(candidate.observedAt) ? candidate.observedAt : now,
    expiresAt,
    evidence: candidate.evidence ?? null,
  });
}

/** Define one discovery provider. Network algorithms remain in the adapted subsystem. */
export function createDiscoveryProvider({
  id,
  kind = DISCOVERY_KIND.CUSTOM,
  priority = 0,
  discover,
  advertise = null,
  revoke = null,
  health = null,
} = {}) {
  if (!id || typeof id !== 'string') throw new TypeError('discovery provider requires an id');
  if (typeof discover !== 'function') throw new TypeError('discovery provider requires discover(query)');
  if (!Object.values(DISCOVERY_KIND).includes(kind)) throw new TypeError(`unsupported discovery provider kind: ${kind}`);
  if (!Number.isFinite(priority)) throw new TypeError('discovery provider priority must be finite');
  if (advertise != null && typeof advertise !== 'function') throw new TypeError('advertise must be a function');
  if (revoke != null && typeof revoke !== 'function') throw new TypeError('revoke must be a function');
  if (health != null && typeof health !== 'function') throw new TypeError('health must be a function');
  return Object.freeze({ id, kind, priority, discover, advertise, revoke, health });
}

export function createDiscoveryRegistry({ now = () => Date.now(), logger = () => {} } = {}) {
  if (typeof now !== 'function' || typeof logger !== 'function') throw new TypeError('invalid discovery registry hooks');
  return { providers: new Map(), now, logger, status: new Map() };
}

export function registerDiscoveryProvider(registry, provider) {
  if (!provider?.id || typeof provider.discover !== 'function') throw new TypeError('invalid discovery provider');
  if (registry.providers.has(provider.id)) throw new Error(`discovery provider already registered: ${provider.id}`);
  registry.providers.set(provider.id, provider);
  registry.status.set(provider.id, { ok: null, lastRunAt: null, resultCount: 0, reason: 'not-run' });
  emit(registry, 'provider.registered', { providerId: provider.id, kind: provider.kind });
  return provider;
}

export function unregisterDiscoveryProvider(registry, providerId) {
  registry.status.delete(providerId);
  const removed = registry.providers.delete(providerId);
  if (removed) emit(registry, 'provider.unregistered', { providerId });
  return removed;
}

function withTimeout(promise, timeoutMs, providerId) {
  let timer;
  return Promise.race([
    Promise.resolve(promise),
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`discovery provider timed out: ${providerId}`)), timeoutMs);
    }),
  ]).finally(() => clearTimeout(timer));
}

function mergeCandidate(into, candidate) {
  if (!into) return {
    ...candidate,
    sourceIds: [...candidate.sourceIds],
    routeHints: [...candidate.routeHints],
    transportHints: [...candidate.transportHints],
    capabilities: [...candidate.capabilities],
    evidence: candidate.evidence == null ? [] : [candidate.evidence],
  };
  for (const source of candidate.sourceIds) if (!into.sourceIds.includes(source)) into.sourceIds.push(source);
  for (const hint of candidate.routeHints) if (!into.routeHints.includes(hint)) into.routeHints.push(hint);
  for (const hint of candidate.transportHints) if (!into.transportHints.includes(hint)) into.transportHints.push(hint);
  for (const cap of candidate.capabilities) if (!into.capabilities.includes(cap)) into.capabilities.push(cap);
  if (candidate.evidence != null) into.evidence.push(candidate.evidence);
  into.observedAt = Math.max(into.observedAt, candidate.observedAt);
  if (candidate.expiresAt != null) into.expiresAt = into.expiresAt == null
    ? candidate.expiresAt
    : Math.max(into.expiresAt, candidate.expiresAt);
  return into;
}

/** Query all enabled providers concurrently; one provider failure never erases valid peer results. */
export async function discoverRealmPeers(registry, query = {}, { timeoutMs = 5000, correlationId = null } = {}) {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new RangeError('timeoutMs must be positive');
  const startedAt = registry.now();
  const providers = [...registry.providers.values()].sort((a, b) => b.priority - a.priority || a.id.localeCompare(b.id));
  emit(registry, 'discover.enter', { correlationId, providerCount: providers.length });
  const runs = providers.map(async (provider) => {
    try {
      const raw = await withTimeout(provider.discover({ ...query, sourceId: provider.id }), timeoutMs, provider.id);
      if (!Array.isArray(raw)) throw new TypeError(`discovery provider ${provider.id} did not return an array`);
      if (raw.length > MAX_RESULTS_PER_PROVIDER) throw new RangeError(`discovery provider ${provider.id} exceeded result limit`);
      const candidates = [];
      for (const item of raw) {
        try { candidates.push(normalizeDiscoveryCandidate(item, { sourceId: provider.id, now: registry.now() })); }
        catch (_) { /* Reject malformed or expired individual records without hiding healthy records. */ }
      }
      registry.status.set(provider.id, { ok: true, lastRunAt: registry.now(), resultCount: candidates.length, reason: null });
      return candidates;
    } catch (error) {
      registry.status.set(provider.id, { ok: false, lastRunAt: registry.now(), resultCount: 0, reason: error?.message ?? 'provider-failed' });
      emit(registry, 'provider.failed', { correlationId, providerId: provider.id, reason: error?.message ?? 'provider-failed' }, 'warn');
      return [];
    }
  });
  const merged = new Map();
  for (const results of await Promise.all(runs)) {
    for (const candidate of results) merged.set(candidate.peerId, mergeCandidate(merged.get(candidate.peerId), candidate));
  }
  const peers = [...merged.values()].map((candidate) => Object.freeze({
    ...candidate,
    sourceIds: Object.freeze(candidate.sourceIds),
    routeHints: Object.freeze(candidate.routeHints),
    transportHints: Object.freeze(candidate.transportHints),
    capabilities: Object.freeze(candidate.capabilities),
    evidence: Object.freeze(candidate.evidence),
  }));
  emit(registry, 'discover.exit', {
    correlationId,
    peerCount: peers.length,
    durationMs: Math.max(0, registry.now() - startedAt),
  });
  return peers;
}

export function discoveryProviderStatus(registry) {
  return [...registry.status.entries()].map(([providerId, status]) => ({ providerId, ...status }));
}

/** Adapt the existing ordered bootstrap registry without reproducing its scan logic. */
export function createBootstrapRegistryProvider({ id = 'bootstrap', registry, priority = 10 } = {}) {
  if (!registry) throw new TypeError('bootstrap discovery provider requires a bootstrap registry');
  return createDiscoveryProvider({
    id,
    kind: DISCOVERY_KIND.BOOTSTRAP,
    priority,
    async discover() {
      const records = flattenBootstrapResults(await runBootstrap(registry));
      return records.filter((record) => record?.peerId);
    },
  });
}

/** Adapt the existing signed peer-ticket store into discovery hints. */
export function createPeerTicketDiscoveryProvider({ id = 'peer-tickets', store, priority = 100 } = {}) {
  if (!store) throw new TypeError('peer-ticket discovery provider requires a ticket store');
  return createDiscoveryProvider({
    id,
    kind: DISCOVERY_KIND.PEER_TICKET,
    priority,
    async discover() {
      return listPeerTicketsByFreshness(store).map(({ peerId, ticket, receivedAt }) => ({
        peerId,
        routeHints: ticket?.payload?.routeHints ?? [],
        capabilities: ticket?.payload?.services ?? [],
        expiresAt: ticket?.payload?.expiresAt ?? null,
        observedAt: receivedAt,
        evidence: ticket,
      }));
    },
  });
}

/** Adapt the existing mesh DHT query transport; callers choose exactly one query key. */
export function createDhtDiscoveryProvider({ id = 'dht', transport, priority = 20 } = {}) {
  if (!transport) throw new TypeError('DHT discovery provider requires a DHT transport');
  return createDiscoveryProvider({
    id,
    kind: DISCOVERY_KIND.DHT,
    priority,
    async discover(query) {
      if (query.peerId) {
        const result = await findPeerOverNetwork(transport, query.peerId, { timeoutMs: query.timeoutMs });
        return result?.found ? [{ peerId: query.peerId, routeHints: result.routeHints ?? [] }] : [];
      }
      const result = query.routeId
        ? await findRouteOverNetwork(transport, query.routeId, { timeoutMs: query.timeoutMs })
        : query.providerKey
          ? await findProvidersOverNetwork(transport, query.providerKey, { timeoutMs: query.timeoutMs })
          : null;
      return (result?.peers ?? []).map((peerId) => ({ peerId }));
    },
  });
}
