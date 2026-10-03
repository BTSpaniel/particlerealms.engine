// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

// network/dht/DhtTransport.js — a scoped-down real transport for
// DhtNode.js's FIND_PEER/FIND_ROUTE/FIND_PROVIDERS queries (network plan
// §47, low priority). Deliberately NOT a full Kademlia DHT (no k-buckets,
// no XOR distance routing, no iterative closest-node lookup) — this is a
// minimal query/forward/respond loop over the existing mesh:
//
//   1. A query with no local answer is gossip-flooded across the mesh via
//      CollabMeshTopology.js's existing TTL+dedupe fanout (same mechanism
//      CarrierRelay.js uses) — reuses its per-query fingerprint
//      (`_gossip.fp`) as this transport's queryId, so no new id scheme or
//      message-shape changes were needed in DhtMessages.js.
//   2. Every node that relays a (non-duplicate) query remembers which
//      neighbor it heard the query from (`reversePaths`) — classic
//      flood/reverse-path relay (the same idea AODV uses), not a gossip
//      broadcast itself.
//   3. Any node with a local answer (from its own DhtNode.js knowledge)
//      sends a direct (non-gossiped) DHT_RESPONSE back along that reverse
//      path, one hop at a time, until it reaches the original requester.
//
// Known MVP limitation (intentional, per the plan's "low priority" scope):
// `reversePaths` entries are not proactively pruned by this module; a real
// deployment would want a TTL sweep alongside `pruneDhtNode()`.

import { gossipWrap, gossipReceive, getNeighborIds } from '../../collab/CollabMeshTopology.js';
import {
  makeFindPeerMessage, makeFindRouteMessage, makeFindProvidersMessage,
  makeAnnounceProviderMessage, makeAnnounceRouteMessage, makePeerExchangeMessage,
} from './DhtMessages.js';
import {
  handleFindPeer, handleFindRoute, handleFindProviders,
  handleAnnounceProvider, handlePeerExchange, rememberPeer, listKnownPeers,
} from './DhtNode.js';
import { signEnvelope, verifyEnvelope, PROTOCOL_VERSIONS } from '../protocol.js';
import { computeFingerprint } from '../identity/NetworkIdentity.js';
import { hexToBytes } from '../../core/math/FormatMath.js';
import { MAX_PROVIDER_TTL_MS } from './ProviderStore.js';
import { createDedupeCache, checkAndMark } from '../chunks/DedupeCache.js';

const DHT_QUERY_TYPES = new Set(['FIND_PEER', 'FIND_ROUTE', 'FIND_PROVIDERS']);
const DHT_CONTROL_TYPES = new Set(['ANNOUNCE_PROVIDER', 'ANNOUNCE_ROUTE', 'PEER_EXCHANGE']);
const DHT_RESPONSE_TYPE = 'DHT_RESPONSE';
const DEFAULT_QUERY_TIMEOUT_MS = 5000;
const MAX_PEER_EXCHANGE = 64;
const MAX_ROUTE_HINTS_PER_PEER = 32;
const DHT_CONTROL_MAX_AGE_MS = 5 * 60 * 1000;
const DHT_CONTROL_FUTURE_SKEW_MS = 30 * 1000;
const DHT_CONTROL_DEDUPE_TTL_MS = 10 * 60 * 1000;

/**
 * @param {object} c
 * @param {(peerId:string, data:object) => void} c.sendToPeer  e.g. `(peerId, data) => sendToPeer(core, peerId, data)`
 * @param {object} c.topology   from `createMeshTopology()`
 * @param {object} c.node       from `createDhtNode()` — local knowledge this node answers queries from
 * @returns {object} transport state
 */
export function createDhtTransport({
  sendToPeer,
  topology,
  node,
  verifyControlIdentity = async () => true,
  now = () => Date.now(),
  logger = () => {},
} = {}) {
  if (typeof sendToPeer !== 'function') throw new TypeError('createDhtTransport requires a sendToPeer function');
  if (!topology) throw new TypeError('createDhtTransport requires a topology (createMeshTopology())');
  if (!node) throw new TypeError('createDhtTransport requires a node (createDhtNode())');
  if (typeof verifyControlIdentity !== 'function' || typeof now !== 'function' || typeof logger !== 'function') {
    throw new TypeError('createDhtTransport received invalid verification/diagnostic hooks');
  }
  return {
    sendToPeer, topology, node,
    verifyControlIdentity, now, logger,
    pendingQueries: new Map(), // queryId -> { resolve, timer }
    reversePaths: new Map(),   // queryId -> peerId this node heard the query from
    controlDedupe: createDedupeCache(),
    controlStats: { accepted: 0, rejected: 0, announcements: 0, peerExchanges: 0 },
  };
}

function _emit(transport, event, details = {}, level = 'debug') {
  transport.logger({
    component: 'particle-dht',
    event,
    level,
    at: transport.now(),
    selfPeerId: transport.node.selfPeerId,
    ...details,
  });
}

function _floodQuery(transport, message, timeoutMs) {
  const wrapped = gossipWrap(transport.topology, message);
  const queryId = wrapped._gossip.fp;
  const neighbors = getNeighborIds(transport.topology);
  for (const peerId of neighbors) transport.sendToPeer(peerId, wrapped);

  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      transport.pendingQueries.delete(queryId);
      resolve(null); // no answer within the window — caller falls back to local-only knowledge
    }, timeoutMs);
    transport.pendingQueries.set(queryId, { resolve, timer });
  });
}

/**
 * Query the mesh for a peer's route hints. Checks local knowledge first;
 * only floods the network if we don't already know it.
 * @returns {Promise<{found:boolean, routeHints:string[]}|null>} null if no answer arrived in time
 */
export function findPeerOverNetwork(transport, targetPeerId, { timeoutMs = DEFAULT_QUERY_TIMEOUT_MS } = {}) {
  const local = handleFindPeer(transport.node, targetPeerId);
  if (local.found) return Promise.resolve(local);
  const message = makeFindPeerMessage({ targetPeerId, requesterPeerId: transport.node.selfPeerId });
  return _floodQuery(transport, message, timeoutMs);
}

/** Query the mesh for a route's live providers. Checks local knowledge first. */
export function findRouteOverNetwork(transport, routeId, { timeoutMs = DEFAULT_QUERY_TIMEOUT_MS } = {}) {
  const local = handleFindRoute(transport.node, routeId);
  if (local.length) return Promise.resolve({ found: true, peers: local });
  const message = makeFindRouteMessage({ routeId, requesterPeerId: transport.node.selfPeerId });
  return _floodQuery(transport, message, timeoutMs);
}

/** Query the mesh for an arbitrary key's providers (chunk hash, service name, ...). Checks local knowledge first. */
export function findProvidersOverNetwork(transport, key, { timeoutMs = DEFAULT_QUERY_TIMEOUT_MS } = {}) {
  const local = handleFindProviders(transport.node, key);
  if (local.length) return Promise.resolve({ found: true, peers: local });
  const message = makeFindProvidersMessage({ key, requesterPeerId: transport.node.selfPeerId });
  return _floodQuery(transport, message, timeoutMs);
}

function _answerLocally(node, op) {
  switch (op.type) {
    case 'FIND_PEER': {
      const r = handleFindPeer(node, op.payload.targetPeerId);
      return r.found ? { found: true, routeHints: r.routeHints } : null;
    }
    case 'FIND_ROUTE': {
      const peers = handleFindRoute(node, op.payload.routeId);
      return peers.length ? { found: true, peers } : null;
    }
    case 'FIND_PROVIDERS': {
      const peers = handleFindProviders(node, op.payload.key);
      return peers.length ? { found: true, peers } : null;
    }
    default:
      return null;
  }
}

async function _verifySignedControl(transport, fromPeerId, op) {
  if (op.protocol !== PROTOCOL_VERSIONS.DHT || !DHT_CONTROL_TYPES.has(op.type)) return { ok: false, reason: 'bad-protocol' };
  if (!op.signature || !op.signerPublicKeyHex || op.signerFingerprint !== fromPeerId) {
    return { ok: false, reason: 'peer-binding' };
  }
  const now = transport.now();
  if (!Number.isFinite(op.issuedAt) || op.issuedAt < now - DHT_CONTROL_MAX_AGE_MS
    || op.issuedAt > now + DHT_CONTROL_FUTURE_SKEW_MS) {
    return { ok: false, reason: 'stale-or-future' };
  }
  let derivedFingerprint;
  try { derivedFingerprint = await computeFingerprint(hexToBytes(op.signerPublicKeyHex)); }
  catch (_) { return { ok: false, reason: 'bad-public-key' }; }
  if (!derivedFingerprint || derivedFingerprint !== op.signerFingerprint) {
    return { ok: false, reason: 'fingerprint-mismatch', derivedFingerprint: derivedFingerprint || null };
  }
  if (!(await verifyEnvelope(op))) return { ok: false, reason: 'bad-signature' };
  const identity = await transport.verifyControlIdentity({
    peerId: fromPeerId,
    signerFingerprint: op.signerFingerprint,
    signerPublicKeyHex: op.signerPublicKeyHex,
    message: op,
  });
  if (identity !== true && identity?.ok !== true) return { ok: false, reason: identity?.reason ?? 'identity-not-authorized' };
  const replayKey = `${op.signerFingerprint}:${op.type}:${op.signature}`;
  if (!checkAndMark(transport.controlDedupe, replayKey, DHT_CONTROL_DEDUPE_TTL_MS, now)) {
    return { ok: false, reason: 'replayed-control' };
  }
  return { ok: true, reason: null };
}

function _boundedPeerExchange(payload) {
  if (!Array.isArray(payload?.knownPeers) || payload.knownPeers.length > MAX_PEER_EXCHANGE) return null;
  const peers = [];
  for (const item of payload.knownPeers) {
    if (!item || typeof item.peerId !== 'string' || !item.peerId || item.peerId.length > 512) return null;
    if (!Array.isArray(item.routeHints) || item.routeHints.length > MAX_ROUTE_HINTS_PER_PEER) return null;
    if (item.routeHints.some((hint) => typeof hint !== 'string' || !hint || hint.length > 512)) return null;
    peers.push({ peerId: item.peerId, routeHints: [...new Set(item.routeHints)] });
  }
  return peers;
}

async function _handleSignedControl(transport, fromPeerId, op) {
  const verified = await _verifySignedControl(transport, fromPeerId, op);
  if (!verified.ok) {
    transport.controlStats.rejected += 1;
    _emit(transport, 'control.rejected', {
      fromPeerId,
      type: op.type,
      reason: verified.reason,
      derivedFingerprint: verified.derivedFingerprint ?? null,
    }, 'warn');
    return true;
  }
  rememberPeer(transport.node, fromPeerId, { direct: true }, transport.now());
  try {
    if (op.type === 'ANNOUNCE_PROVIDER') {
      if (op.payload?.peerId !== fromPeerId) throw new Error('announced peerId is not the signer');
      handleAnnounceProvider(transport.node, {
        key: op.payload.key,
        peerId: fromPeerId,
        ttlMs: op.payload.ttlMs,
      }, transport.now());
      transport.controlStats.announcements += 1;
    } else if (op.type === 'ANNOUNCE_ROUTE') {
      if (op.payload?.peerId !== fromPeerId) throw new Error('announced peerId is not the signer');
      if (!Array.isArray(op.payload.services) || op.payload.services.length > 64) throw new Error('invalid route services');
      handleAnnounceProvider(transport.node, {
        key: op.payload.routeId,
        peerId: fromPeerId,
        ttlMs: op.payload.ttlMs,
      }, transport.now());
      rememberPeer(transport.node, fromPeerId, { routeHints: [op.payload.routeId], direct: true }, transport.now());
      transport.controlStats.announcements += 1;
    } else {
      const peers = _boundedPeerExchange(op.payload);
      if (!peers) throw new Error('invalid peer exchange');
      handlePeerExchange(transport.node, peers.filter((item) => item.peerId !== transport.node.selfPeerId), transport.now(), { reportedBy: fromPeerId });
      transport.controlStats.peerExchanges += 1;
    }
    transport.controlStats.accepted += 1;
    _emit(transport, 'control.accepted', { fromPeerId, type: op.type });
  } catch (error) {
    transport.controlStats.rejected += 1;
    _emit(transport, 'control.rejected', { fromPeerId, type: op.type, reason: error?.message ?? 'invalid-control' }, 'warn');
  }
  return true;
}

function _assertLocalSigner(transport, signer) {
  if (!signer || typeof signer.sign !== 'function') throw new TypeError('DHT control message requires a signer');
  if (signer.secure === false) throw new Error('DHT control message refuses an insecure fallback signer');
  if (!transport.node.selfPeerId || signer.fingerprint !== transport.node.selfPeerId) {
    throw new Error('DHT signer must match node.selfPeerId');
  }
}

async function _signAndSendToNeighbors(transport, envelope, signer) {
  _assertLocalSigner(transport, signer);
  const signed = await signEnvelope(envelope, signer);
  const neighbors = getNeighborIds(transport.topology);
  for (const peerId of neighbors) transport.sendToPeer(peerId, signed);
  return { signed, sentTo: neighbors };
}

/** Authenticated, bounded provider announcement to current mesh neighbors. */
export async function announceProviderOverNetwork(transport, { key, ttlMs, signer } = {}) {
  const effectiveTtl = ttlMs ?? 5 * 60 * 1000;
  if (!Number.isFinite(effectiveTtl) || effectiveTtl <= 0 || effectiveTtl > MAX_PROVIDER_TTL_MS) {
    throw new RangeError(`provider ttlMs must be 1..${MAX_PROVIDER_TTL_MS}`);
  }
  const envelope = makeAnnounceProviderMessage({ key, peerId: transport.node.selfPeerId, ttlMs: effectiveTtl });
  handleAnnounceProvider(transport.node, { key, peerId: transport.node.selfPeerId, ttlMs: effectiveTtl }, transport.now());
  const result = await _signAndSendToNeighbors(transport, envelope, signer);
  _emit(transport, 'provider.announced', { key, neighborCount: result.sentTo.length, ttlMs: effectiveTtl });
  return result;
}

/** Authenticated route announcement; services are descriptive and bounded, never ambient authority. */
export async function announceRouteOverNetwork(transport, { routeId, services = [], ttlMs, signer } = {}) {
  if (!Array.isArray(services) || services.length > 64 || services.some((item) => typeof item !== 'string' || !item || item.length > 256)) {
    throw new TypeError('route services must be a bounded string array');
  }
  const effectiveTtl = ttlMs ?? 5 * 60 * 1000;
  const envelope = makeAnnounceRouteMessage({ routeId, peerId: transport.node.selfPeerId, services, ttlMs: effectiveTtl });
  handleAnnounceProvider(transport.node, { key: routeId, peerId: transport.node.selfPeerId, ttlMs: effectiveTtl }, transport.now());
  rememberPeer(transport.node, transport.node.selfPeerId, { routeHints: [routeId], direct: true }, transport.now());
  const result = await _signAndSendToNeighbors(transport, envelope, signer);
  _emit(transport, 'route.announced', { routeId, neighborCount: result.sentTo.length, ttlMs: effectiveTtl });
  return result;
}

/** Send a signed, bounded sample of local peer knowledge to one connected peer. */
export async function sendPeerExchangeOverNetwork(transport, { peerId, signer, limit = MAX_PEER_EXCHANGE } = {}) {
  _assertLocalSigner(transport, signer);
  if (!getNeighborIds(transport.topology).includes(peerId)) throw new Error('peer exchange target is not a current neighbor');
  const knownPeers = listKnownPeers(transport.node, { limit })
    .filter((item) => item.peerId !== peerId && item.peerId !== transport.node.selfPeerId);
  const signed = await signEnvelope(makePeerExchangeMessage({ knownPeers }), signer);
  transport.sendToPeer(peerId, signed);
  _emit(transport, 'peers.exchanged', { peerId, peerCount: knownPeers.length });
  return signed;
}

export function getDhtTransportHealth(transport) {
  return Object.freeze({
    status: transport.controlStats.rejected > 0 ? 'degraded' : 'healthy',
    reason: transport.controlStats.rejected > 0 ? 'signed-control-rejections' : null,
    metrics: Object.freeze({
      knownPeers: transport.node.knownPeers.size,
      pendingQueries: transport.pendingQueries.size,
      reversePaths: transport.reversePaths.size,
      ...transport.controlStats,
    }),
  });
}

/**
 * Feed every relevant `onOp(peerId, op)` message through this, alongside
 * `ChunkTransport.js`'s and `CarrierRelay.js`'s own handlers (same
 * "return false if not ours" chaining pattern).
 * @returns {boolean} true if this message was a DHT-transport message (handled)
 */
export function handleDhtMessage(transport, fromPeerId, op) {
  if (!op) return false;

  // Provider announcements and peer exchange are direct, signed statements.
  // Returning a Promise is supported by OsNetworkSession's ordered handler
  // chain; unrelated and query messages retain their synchronous behavior.
  if (DHT_CONTROL_TYPES.has(op.type)) return _handleSignedControl(transport, fromPeerId, op);

  // Responses are sent as plain (non-gossiped) direct messages tracing the
  // reverse path one hop at a time.
  if (op.type === DHT_RESPONSE_TYPE) {
    const { queryId, result } = op.payload;
    const pending = transport.pendingQueries.get(queryId);
    if (pending) {
      clearTimeout(pending.timer);
      transport.pendingQueries.delete(queryId);
      pending.resolve(result);
      return true;
    }
    const backTo = transport.reversePaths.get(queryId);
    if (backTo) transport.sendToPeer(backTo, op);
    return true;
  }

  if (!op._gossip || !DHT_QUERY_TYPES.has(op.type)) return false;

  const { forward, op: innerOp, targets, forwardOp } = gossipReceive(transport.topology, fromPeerId, op);
  if (!innerOp) return true; // duplicate or TTL-exhausted at the mesh layer — dropped

  const queryId = innerOp._gossip.fp;
  if (!transport.reversePaths.has(queryId)) transport.reversePaths.set(queryId, fromPeerId);

  const answer = _answerLocally(transport.node, innerOp);
  if (answer) {
    transport.sendToPeer(fromPeerId, {
      protocol: innerOp.protocol, type: DHT_RESPONSE_TYPE,
      payload: { queryId, requestType: innerOp.type, result: answer },
    });
  }

  if (forward && targets.length) {
    for (const peerId of targets) transport.sendToPeer(peerId, forwardOp);
  }
  return true;
}
