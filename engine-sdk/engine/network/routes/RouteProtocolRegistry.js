// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

import { PROTOCOL_VERSIONS, isKnownProtocol, makeEnvelope } from '../protocol.js';

export const ROUTE_PROTOCOL_CONTROL = Object.freeze({
  CATALOG: 'PROTOCOL_CATALOG',
});

const VERSIONED_PROTOCOL = /^[a-z][a-z0-9-]{0,95}\/[1-9][0-9]{0,8}$/;
const MAX_PROTOCOLS = 128;
const MAX_DESCRIPTORS = 128;
const DEFAULT_MAX_MESSAGE_BYTES = 8 * 1024 * 1024;

function boundedId(value, name, max = 128) {
  const result = String(value ?? '').trim();
  if (!result || result.length > max) throw new TypeError(`${name} must be a non-empty bounded string`);
  return result;
}

function emit(registry, event, details = {}, level = 'debug') {
  registry.logger({
    component: 'route-protocol-registry',
    event,
    level,
    at: registry.now(),
    ...details,
  });
}

function normalizedProtocols(values, { knownOnly = true } = {}) {
  if (!Array.isArray(values) || values.length > MAX_PROTOCOLS) {
    throw new RangeError(`protocol catalog must contain at most ${MAX_PROTOCOLS} entries`);
  }
  const protocols = [];
  for (const value of values) {
    const protocol = boundedId(value, 'protocol');
    if (!VERSIONED_PROTOCOL.test(protocol)) throw new TypeError(`invalid versioned protocol namespace: ${protocol}`);
    if (knownOnly && !isKnownProtocol(protocol)) throw new TypeError(`unknown local protocol namespace: ${protocol}`);
    if (!protocols.includes(protocol)) protocols.push(protocol);
  }
  return protocols.sort();
}

function finiteLimit(value, fallback = DEFAULT_MAX_MESSAGE_BYTES) {
  const number = value == null ? fallback : Number(value);
  if (!Number.isSafeInteger(number) || number < 1 || number > DEFAULT_MAX_MESSAGE_BYTES) {
    throw new RangeError(`maxBytes must be an integer in [1, ${DEFAULT_MAX_MESSAGE_BYTES}]`);
  }
  return number;
}

function estimateBytes(value, limit) {
  const encoder = new TextEncoder();
  const seen = new Set();
  let total = 0;
  const add = (amount) => {
    total += amount;
    if (total > limit) throw new RangeError('route protocol message exceeds its byte limit');
  };
  const visit = (item) => {
    if (item == null) { add(4); return; }
    if (typeof item === 'string') { add(encoder.encode(item).byteLength + 2); return; }
    if (typeof item === 'number' || typeof item === 'boolean') { add(String(item).length); return; }
    if (item instanceof ArrayBuffer) { add(item.byteLength); return; }
    if (ArrayBuffer.isView(item)) { add(item.byteLength); return; }
    if (typeof item !== 'object') throw new TypeError('route protocol message is not serializable');
    if (seen.has(item)) throw new TypeError('route protocol message contains a cycle');
    seen.add(item);
    if (Array.isArray(item)) {
      add(2);
      for (const entry of item) visit(entry);
    } else {
      add(2);
      for (const [key, entry] of Object.entries(item)) {
        add(encoder.encode(key).byteLength + 3);
        visit(entry);
      }
    }
    seen.delete(item);
  };
  visit(value);
  return total;
}

function emptyStats() {
  return { received: 0, handled: 0, rejected: 0, errors: 0, bytes: 0, durationMs: 0 };
}

export function createRouteProtocolRegistry({
  now = () => Date.now(),
  clock = () => globalThis.performance?.now?.() ?? Date.now(),
  logger = () => {},
  maxMessageBytes = DEFAULT_MAX_MESSAGE_BYTES,
} = {}) {
  if (typeof now !== 'function' || typeof clock !== 'function' || typeof logger !== 'function') {
    throw new TypeError('route protocol registry hooks must be functions');
  }
  return {
    descriptors: new Map(),
    peers: new Map(),
    stats: new Map(),
    totals: emptyStats(),
    now,
    clock,
    logger,
    maxMessageBytes: finiteLimit(maxMessageBytes),
  };
}

export function registerRouteProtocol(registry, {
  id,
  protocols = [],
  matches = null,
  handle,
  authorize = null,
  validate = null,
  priority = 0,
  maxBytes = null,
} = {}) {
  const descriptorId = boundedId(id, 'route protocol descriptor id');
  if (registry.descriptors.has(descriptorId)) throw new Error(`route protocol already registered: ${descriptorId}`);
  if (registry.descriptors.size >= MAX_DESCRIPTORS) throw new RangeError('route protocol descriptor limit reached');
  if (typeof handle !== 'function') throw new TypeError('route protocol descriptor requires handle(peerId, op)');
  if (matches != null && typeof matches !== 'function') throw new TypeError('route protocol matches must be a function');
  if (authorize != null && typeof authorize !== 'function') throw new TypeError('route protocol authorize must be a function');
  if (validate != null && typeof validate !== 'function') throw new TypeError('route protocol validate must be a function');
  if (!Number.isFinite(priority)) throw new TypeError('route protocol priority must be finite');
  const descriptor = Object.freeze({
    id: descriptorId,
    protocols: Object.freeze(normalizedProtocols(protocols)),
    matches,
    handle,
    authorize,
    validate,
    priority,
    maxBytes: finiteLimit(maxBytes, registry.maxMessageBytes),
  });
  registry.descriptors.set(descriptorId, descriptor);
  registry.stats.set(descriptorId, emptyStats());
  emit(registry, 'protocol.registered', { descriptorId, protocols: descriptor.protocols });
  return () => unregisterRouteProtocol(registry, descriptorId);
}

export function unregisterRouteProtocol(registry, descriptorId) {
  const id = String(descriptorId);
  registry.stats.delete(id);
  const removed = registry.descriptors.delete(id);
  if (removed) emit(registry, 'protocol.unregistered', { descriptorId: id });
  return removed;
}

export function routeProtocolCatalog(registry) {
  const protocols = new Set([PROTOCOL_VERSIONS.NETWORK]);
  for (const descriptor of registry.descriptors.values()) {
    for (const protocol of descriptor.protocols) protocols.add(protocol);
  }
  return Object.freeze([...protocols].sort());
}

export function createRouteProtocolCatalogOp(registry) {
  return makeEnvelope({
    protocol: PROTOCOL_VERSIONS.NETWORK,
    type: ROUTE_PROTOCOL_CONTROL.CATALOG,
    payload: { protocols: routeProtocolCatalog(registry) },
  });
}

export function forgetRouteProtocolPeer(registry, peerId) {
  return registry.peers.delete(String(peerId));
}

export function peerSupportsRouteProtocol(registry, peerId, protocol) {
  const peer = registry.peers.get(String(peerId));
  if (!peer) return null;
  return peer.protocols.has(String(protocol));
}

function acceptCatalog(registry, peerId, op) {
  if (op?.protocol !== PROTOCOL_VERSIONS.NETWORK || op?.type !== ROUTE_PROTOCOL_CONTROL.CATALOG) return false;
  try {
    const protocols = normalizedProtocols(op?.payload?.protocols ?? [], { knownOnly: false });
    registry.peers.set(String(peerId), Object.freeze({
      peerId: String(peerId),
      protocols: new Set(protocols),
      observedAt: registry.now(),
    }));
    emit(registry, 'catalog.accepted', { peerId: String(peerId), protocolCount: protocols.length });
  } catch (error) {
    registry.totals.rejected++;
    emit(registry, 'catalog.rejected', { peerId: String(peerId), reason: error?.message ?? 'invalid-catalog' }, 'warn');
  }
  return true;
}

function descriptorMatches(descriptor, op) {
  if (typeof op?.protocol === 'string' && descriptor.protocols.includes(op.protocol)) return true;
  if (!descriptor.matches) return false;
  try { return descriptor.matches(op) === true; } catch (_) { return false; }
}

function updateStats(registry, descriptorId, field, amount = 1) {
  const descriptorStats = registry.stats.get(descriptorId);
  if (descriptorStats) descriptorStats[field] += amount;
  registry.totals[field] += amount;
}

/** Dispatch one route operation. Protocol-bearing traffic always fails closed. */
export async function dispatchRouteProtocol(registry, peerId, op, context = {}) {
  if (acceptCatalog(registry, peerId, op)) return true;
  const hasProtocol = typeof op?.protocol === 'string';
  if (hasProtocol && (!VERSIONED_PROTOCOL.test(op.protocol) || !isKnownProtocol(op.protocol))) {
    registry.totals.received++;
    registry.totals.rejected++;
    emit(registry, 'message.rejected', { peerId: String(peerId), protocol: op.protocol, reason: 'unknown-protocol' }, 'warn');
    return true;
  }

  const descriptors = [...registry.descriptors.values()]
    .filter((descriptor) => descriptorMatches(descriptor, op))
    .sort((a, b) => b.priority - a.priority || a.id.localeCompare(b.id));
  if (descriptors.length === 0) return hasProtocol;

  for (const descriptor of descriptors) {
    const started = registry.clock();
    let bytes = 0;
    updateStats(registry, descriptor.id, 'received');
    try {
      bytes = estimateBytes(op, descriptor.maxBytes);
      updateStats(registry, descriptor.id, 'bytes', bytes);
      if (descriptor.validate && await descriptor.validate(op, { peerId: String(peerId), ...context }) !== true) {
        updateStats(registry, descriptor.id, 'rejected');
        emit(registry, 'message.rejected', { descriptorId: descriptor.id, peerId: String(peerId), reason: 'validation' }, 'warn');
        return true;
      }
      if (descriptor.authorize && await descriptor.authorize({ peerId: String(peerId), op, ...context }) !== true) {
        updateStats(registry, descriptor.id, 'rejected');
        emit(registry, 'message.rejected', { descriptorId: descriptor.id, peerId: String(peerId), reason: 'authorization' }, 'warn');
        return true;
      }
      const handled = await descriptor.handle(String(peerId), op, context);
      const elapsed = Math.max(0, registry.clock() - started);
      updateStats(registry, descriptor.id, 'durationMs', elapsed);
      if (handled) {
        updateStats(registry, descriptor.id, 'handled');
        emit(registry, 'message.handled', { descriptorId: descriptor.id, peerId: String(peerId), bytes, durationMs: elapsed });
        return true;
      }
    } catch (error) {
      const elapsed = Math.max(0, registry.clock() - started);
      updateStats(registry, descriptor.id, 'durationMs', elapsed);
      updateStats(registry, descriptor.id, error instanceof RangeError ? 'rejected' : 'errors');
      emit(registry, 'message.failed', {
        descriptorId: descriptor.id,
        peerId: String(peerId),
        reason: error?.message ?? 'handler-failed',
        durationMs: elapsed,
      }, error instanceof RangeError ? 'warn' : 'error');
      return true;
    }
  }

  registry.totals.rejected++;
  emit(registry, 'message.unhandled', { peerId: String(peerId), protocol: op?.protocol ?? null }, 'warn');
  return true;
}

export function routeProtocolRegistryStatus(registry) {
  const descriptors = [...registry.descriptors.values()]
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((descriptor) => Object.freeze({
      id: descriptor.id,
      protocols: descriptor.protocols,
      priority: descriptor.priority,
      maxBytes: descriptor.maxBytes,
      stats: Object.freeze({ ...registry.stats.get(descriptor.id) }),
    }));
  const peers = [...registry.peers.values()]
    .sort((a, b) => a.peerId.localeCompare(b.peerId))
    .map((peer) => Object.freeze({
      peerId: peer.peerId,
      protocols: Object.freeze([...peer.protocols].sort()),
      observedAt: peer.observedAt,
    }));
  return Object.freeze({
    catalog: routeProtocolCatalog(registry),
    descriptors: Object.freeze(descriptors),
    peers: Object.freeze(peers),
    totals: Object.freeze({ ...registry.totals }),
  });
}

