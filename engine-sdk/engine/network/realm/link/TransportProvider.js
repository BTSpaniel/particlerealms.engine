// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

// Realm transport providers adapt existing channels. They do not implement
// WebRTC, relays, WebSockets, LAN sockets, or encryption themselves.

export const TRANSPORT_KIND = Object.freeze({
  LAN: 'lan',
  DIRECT: 'direct',
  WEBRTC: 'webrtc',
  RELAY: 'relay',
  WEBSOCKET: 'websocket',
  CUSTOM: 'custom',
});

export const DEFAULT_TRANSPORT_PRIORITY = Object.freeze({
  [TRANSPORT_KIND.LAN]: 500,
  [TRANSPORT_KIND.DIRECT]: 400,
  [TRANSPORT_KIND.WEBRTC]: 350,
  [TRANSPORT_KIND.RELAY]: 200,
  [TRANSPORT_KIND.WEBSOCKET]: 100,
  [TRANSPORT_KIND.CUSTOM]: 0,
});

function emit(registry, event, details = {}, level = 'debug') {
  registry.logger({
    component: 'realm-transport',
    event,
    level,
    at: registry.now(),
    correlationId: details.correlationId ?? null,
    ...details,
  });
}

/** Validate the minimal bidirectional channel RealmLink consumes. */
export function assertRealmTransportSession(session) {
  if (!session || typeof session !== 'object') throw new TypeError('transport provider returned no session');
  if (!session.id || typeof session.id !== 'string') throw new TypeError('transport session requires an id');
  if (typeof session.send !== 'function') throw new TypeError('transport session requires send(message)');
  if (typeof session.subscribe !== 'function') throw new TypeError('transport session requires subscribe(handler)');
  if (typeof session.close !== 'function') throw new TypeError('transport session requires close(reason)');
  if (session.priority != null && !Number.isFinite(session.priority)) throw new TypeError('transport session priority must be finite');
  return session;
}

export function createTransportProvider({
  id,
  kind = TRANSPORT_KIND.CUSTOM,
  priority = null,
  canConnect = () => true,
  connect,
  health = null,
} = {}) {
  if (!id || typeof id !== 'string') throw new TypeError('transport provider requires an id');
  if (!Object.values(TRANSPORT_KIND).includes(kind)) throw new TypeError(`unsupported transport kind: ${kind}`);
  if (typeof canConnect !== 'function') throw new TypeError('transport provider requires canConnect(target)');
  if (typeof connect !== 'function') throw new TypeError('transport provider requires connect(target)');
  if (health != null && typeof health !== 'function') throw new TypeError('transport provider health must be a function');
  const resolvedPriority = priority ?? DEFAULT_TRANSPORT_PRIORITY[kind];
  if (!Number.isFinite(resolvedPriority)) throw new TypeError('transport provider priority must be finite');
  return Object.freeze({ id, kind, priority: resolvedPriority, canConnect, connect, health });
}

export function createTransportRegistry({ now = () => Date.now(), logger = () => {} } = {}) {
  if (typeof now !== 'function' || typeof logger !== 'function') throw new TypeError('invalid transport registry hooks');
  return { providers: new Map(), status: new Map(), now, logger };
}

export function registerTransportProvider(registry, provider) {
  if (!provider?.id || typeof provider.connect !== 'function') throw new TypeError('invalid transport provider');
  if (registry.providers.has(provider.id)) throw new Error(`transport provider already registered: ${provider.id}`);
  registry.providers.set(provider.id, provider);
  registry.status.set(provider.id, { ok: null, lastAttemptAt: null, reason: 'not-attempted' });
  emit(registry, 'provider.registered', { providerId: provider.id, kind: provider.kind, priority: provider.priority });
  return provider;
}

export function unregisterTransportProvider(registry, providerId) {
  registry.status.delete(providerId);
  const removed = registry.providers.delete(providerId);
  if (removed) emit(registry, 'provider.unregistered', { providerId });
  return removed;
}

function candidateProviders(registry, target, opts) {
  const preferred = opts.preferredKinds?.length ? new Set(opts.preferredKinds) : null;
  const excluded = new Set(opts.excludeProviderIds ?? []);
  return [...registry.providers.values()]
    .filter((provider) => !excluded.has(provider.id))
    .filter((provider) => !preferred || preferred.has(provider.kind))
    .filter((provider) => {
      try { return provider.canConnect(target); } catch (_) { return false; }
    })
    .sort((a, b) => b.priority - a.priority || a.id.localeCompare(b.id));
}

/**
 * Try compatible providers in priority order. A failed direct path naturally
 * falls through to an existing relay/WebSocket provider.
 */
export async function connectRealmTransport(registry, target, opts = {}) {
  const correlationId = opts.correlationId ?? null;
  const candidates = candidateProviders(registry, target, opts);
  emit(registry, 'connect.enter', { correlationId, peerId: target?.peerId ?? null, candidateCount: candidates.length });
  const failures = [];
  for (const provider of candidates) {
    const startedAt = registry.now();
    try {
      const rawSession = assertRealmTransportSession(await provider.connect(target, {
        signal: opts.signal ?? null,
        correlationId,
      }));
      const session = Object.freeze({
        id: rawSession.id,
        kind: rawSession.kind ?? provider.kind,
        priority: rawSession.priority ?? provider.priority,
        providerId: rawSession.providerId ?? provider.id,
        peerId: rawSession.peerId ?? target?.peerId ?? null,
        send: rawSession.send.bind(rawSession),
        subscribe: rawSession.subscribe.bind(rawSession),
        close: rawSession.close.bind(rawSession),
        raw: rawSession,
      });
      registry.status.set(provider.id, { ok: true, lastAttemptAt: registry.now(), reason: null });
      emit(registry, 'connect.exit', {
        correlationId,
        peerId: target?.peerId ?? null,
        providerId: provider.id,
        transportId: session.id,
        durationMs: Math.max(0, registry.now() - startedAt),
      });
      return { session, provider, failures };
    } catch (error) {
      const reason = error?.message ?? 'transport-connect-failed';
      failures.push({ providerId: provider.id, reason });
      registry.status.set(provider.id, { ok: false, lastAttemptAt: registry.now(), reason });
      emit(registry, 'provider.failed', {
        correlationId,
        providerId: provider.id,
        reason,
        durationMs: Math.max(0, registry.now() - startedAt),
      }, 'warn');
    }
  }
  emit(registry, 'connect.failed', { correlationId, peerId: target?.peerId ?? null, failures }, 'error');
  const error = new Error('no Realm transport provider could connect');
  error.failures = failures;
  throw error;
}

export function transportProviderStatus(registry) {
  return [...registry.status.entries()].map(([providerId, status]) => ({ providerId, ...status }));
}

/** True when a candidate session is a meaningful relay-to-direct upgrade. */
export function isPreferredTransport(candidate, current) {
  assertRealmTransportSession(candidate);
  if (!current) return true;
  assertRealmTransportSession(current);
  const candidatePriority = candidate.priority ?? DEFAULT_TRANSPORT_PRIORITY[candidate.kind] ?? 0;
  const currentPriority = current.priority ?? DEFAULT_TRANSPORT_PRIORITY[current.kind] ?? 0;
  return candidatePriority > currentPriority;
}
