// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

// network/routes/OsNetworkSession.js — the concrete `createSession(routeId,
// opts)` factory `RouteSessionManager.js` was designed to take (network plan
// Phase 2 note: "typically a thin wrapper around
// `createCollabCore({ projectId: routeId, ... })`"). This was the one piece
// of the plan's own architecture that was designed but never actually
// instantiated — Phase 2b shipped the simpler Masterserver-relay-as-direct-
// transport shortcut (`syncManager/SyncTransport.js`) for V1 sync, which
// left `ChunkTransport.js`/`CarrierRelay.js`/`DhtTransport.js` (all three
// built against a real peer-addressed `sendToPeer` + `CollabMeshTopology`)
// with no live mesh to run on. This module closes that gap.
//
// `CollabCore.js`'s Tier 4 signaling (see `CollabSignal.js`'s header
// comment) already reads `os.network.masterServers` from localStorage and
// lazily acquires the shared pinned V2 ParticleNetworkDaemon itself. Explicit
// compatibility endpoints may still use the shared V1 registry. Therefore
// `createCollabCore({ projectId: routeId })` gets real cross-internet WebRTC
// signaling over the same Masterserver config the Control Panel manages.
//
// Deliberately skips CollabCore's own peer-identity/ECDH handshake
// (`publicKeyRaw`/`identityProof`/`ecdhPublicKeyRaw`/`ecdhPrivateKey`,
// `encrypt: true`): that machinery expects raw `CollabIdentity.js` keys
// (ECDH keypair + identity proof), which is a different, lower-level API
// than the CSE-wrapped `createSigner()` this layer's identity/ signers use
// (see `engine/network/identity/NetworkIdentity.js`'s own header comment).
// This is not a security gap — every OS-level payload carried over this
// session already brings its own crypto/verification: `ChunkVerifier.js`
// content hashes, `SealedPacket.js` onion ECDH, `GroupEpoch.js` AES-GCM,
// signed `GroupLedger.js`/`PeerTicket.js` envelopes. CollabCore here is
// used purely as a WebRTC *transport* (data channels + DTLS), the same way
// `ChunkTransport.js` et al. were written to treat any `sendToPeer`.

import {
  createCollabCore, startCollab, destroyCollabCore, setCoreTopology,
  sendToPeer as collabSendToPeer, broadcastOp, broadcastGoodbye, getPeers,
  connectCollabPeer, disconnectCollabPeer, observeCollabPeerMetrics,
} from '../../collab/CollabCore.js';
import {
  createMeshTopology, startTopology, destroyMeshTopology,
  topologyAddPeer, topologyRemovePeer, topologyPeerConnected,
  topologyUpdatePeerMetrics, topologyApplyInfo, topologyRegisterSupernode,
  topologyUnregisterSupernode, resolveTopology, computeIdealNeighbors,
  evaluateSupernodeStatus, rebalanceTopologyNow, buildSupernodeAnnounce,
  buildTopologyInfoOp, getTopologyStats,
} from '../../collab/CollabMeshTopology.js';
import { assertKnownProtocol } from '../protocol.js';
import {
  createRouteProtocolRegistry,
  registerRouteProtocol,
  dispatchRouteProtocol,
  createRouteProtocolCatalogOp,
  forgetRouteProtocolPeer,
  peerSupportsRouteProtocol,
  routeProtocolRegistryStatus,
} from './RouteProtocolRegistry.js';

const TOPOLOGY_TICK_MS = 5000;

/**
 * @param {string} routeId
 * @param {object} [opts]
 * @param {string} opts.selfId                       stable peer id for this session (e.g. `peerIdFromSigner(deviceSigner)`)
 * @param {string} [opts.username]
 * @param {string|Uint8Array|ArrayBuffer|null} [opts.routeSecret] private 32-byte invite secret or passphrase; null marks a public room
 * @param {boolean} [opts.relayOnly=false]      force TURN relay so peers do not learn each other's direct address
 * @param {(peerId:string, op:object) => void} [opts.onUnhandledOp]  called when no registered op handler consumed a message
 * @param {(peerId:string) => void} [opts.onPeerJoin]
 * @param {(peerId:string) => void} [opts.onPeerLeave]
 * @param {object} [opts.protocolRegistry]             optional injected RouteProtocolRegistry
 * @param {(event:object) => void} [opts.logger]       structured protocol diagnostics
 * @returns {object} session — pass to addSessionOpHandler/destroyOsNetworkSession
 */
export function createOsNetworkSession(routeId, opts = {}) {
  if (!routeId) throw new TypeError('createOsNetworkSession requires a routeId');
  if (!opts.selfId) throw new TypeError('createOsNetworkSession requires opts.selfId');

  const session = {
    routeId,
    selfId: opts.selfId,
    topology: null,
    core: null,
    protocolRegistry: opts.protocolRegistry ?? createRouteProtocolRegistry({ logger: opts.logger }),
    _handlers: new Set(),
    _peerMetrics: new Map(),
    _topologyTimer: null,
    _destroyed: false,
  };
  const topology = createMeshTopology(opts.selfId, {
    onConnectPeer: peerId => { void connectCollabPeer(session.core, peerId); },
    onDisconnectPeer: peerId => disconnectCollabPeer(session.core, peerId),
    onSupernodeElected: (_peerId, elected) => {
      const op = elected
        ? buildSupernodeAnnounce(topology)
        : { type: 'supernode_withdraw', payload: { peerId: opts.selfId } };
      if (op && session.core) broadcastOp(session.core, op);
      opts.onRoleChange?.({ isSupernode: elected, topology: getTopologyStats(topology) });
    },
  });
  session.topology = topology;

  const core = createCollabCore({
    projectId: routeId,
    roomPassword: opts.routeSecret ?? null,
    selfId: opts.selfId,
    username: opts.username || 'particle-os-node',
    anonMode: opts.relayOnly === true,
    encrypt: false, // see module doc — OS-level payloads bring their own crypto
    onOp: (peerId, op) => _dispatchOp(session, peerId, op, opts.onUnhandledOp),
    onPeerDiscovered: (peerId) => {
      topologyAddPeer(topology, peerId);
      resolveTopology(topology);
      rebalanceTopologyNow(topology);
    },
    shouldConnectPeer: (peerId) => {
      const peers = computeIdealNeighbors(topology).connect;
      return peers.includes(peerId);
    },
    onPeerJoin: (peerId) => {
      topologyAddPeer(topology, peerId);
      topologyPeerConnected(topology, peerId);
      rebalanceTopologyNow(topology);
      collabSendToPeer(session.core, peerId, createRouteProtocolCatalogOp(session.protocolRegistry));
      opts.onPeerJoin?.(peerId);
    },
    onPeerLeave: (peerId) => {
      topologyRemovePeer(topology, peerId);
      forgetRouteProtocolPeer(session.protocolRegistry, peerId);
      session._peerMetrics.delete(peerId);
      resolveTopology(topology);
      opts.onPeerLeave?.(peerId);
    },
  });
  setCoreTopology(core, topology);
  session.core = core;

  startTopology(topology);
  startCollab(core);
  session._topologyTimer = setInterval(() => { void _topologyTick(session); }, TOPOLOGY_TICK_MS);

  return session;
}

async function _topologyTick(session) {
  if (session._destroyed) return;
  const peers = getPeers(session.core);
  let totalLatency = 0;
  let latencySamples = 0;
  for (const [peerId, peer] of peers) {
    if (!peer.connected) continue;
    const metrics = await observeCollabPeerMetrics(session.core, peerId);
    session._peerMetrics.set(peerId, Object.freeze({ ...metrics, observedAt: Date.now() }));
    topologyUpdatePeerMetrics(session.topology, peerId, metrics);
    if (Number.isFinite(metrics.latency)) {
      totalLatency += metrics.latency;
      latencySamples++;
    }
  }
  const averageLatency = latencySamples ? totalLatency / latencySamples : 999;
  evaluateSupernodeStatus(session.topology, 900, averageLatency, { tier: 'clean', trust: 0.5, socialModifier: 0 });
  rebalanceTopologyNow(session.topology);
  broadcastOp(session.core, buildTopologyInfoOp(session.topology));
  const announce = buildSupernodeAnnounce(session.topology);
  if (announce) broadcastOp(session.core, announce);
}

// Handlers may be sync (return boolean, e.g. ChunkTransport/DhtTransport) or
// async (return Promise<boolean>, e.g. CarrierRelay — peeling an onion layer
// needs a real `await`). Tried strictly in registration order either way:
// an async handler's outcome is awaited before moving on to the next one.
function _dispatchOp(session, peerId, op, onUnhandledOp) {
  if (_handleTopologyOp(session, peerId, op)) return;
  Promise.resolve(dispatchRouteProtocol(session.protocolRegistry, peerId, op, { session }))
    .then((handled) => { if (!handled) _dispatchLegacyOp(session, peerId, op, onUnhandledOp); })
    .catch(() => {
      // A versioned envelope must never fall through to an unversioned legacy
      // handler after protocol validation or dispatch fails.
      if (typeof op?.protocol !== 'string') _dispatchLegacyOp(session, peerId, op, onUnhandledOp);
    });
}

function _dispatchLegacyOp(session, peerId, op, onUnhandledOp) {
  const handlers = [...session._handlers];
  let i = 0;
  const tryNext = () => {
    if (i >= handlers.length) { onUnhandledOp?.(peerId, op); return; }
    const handler = handlers[i++];
    let result;
    try { result = handler(peerId, op); } catch (_) { result = false; }
    if (result && typeof result.then === 'function') {
      result.then((handled) => { if (!handled) tryNext(); }).catch(() => tryNext());
    } else if (!result) {
      tryNext();
    }
    // else: handled synchronously — stop
  };
  tryNext();
}

function _handleTopologyOp(session, peerId, op) {
  if (op?.type === 'topology_info') {
    return topologyApplyInfo(session.topology, peerId, op.payload);
  }
  if (op?.type === 'supernode_announce') {
    return topologyRegisterSupernode(session.topology, peerId, op.payload);
  }
  if (op?.type === 'supernode_withdraw' && op?.payload?.peerId === peerId) {
    return topologyUnregisterSupernode(session.topology, peerId);
  }
  return false;
}

/**
 * Register an op handler (e.g. `ChunkTransport.js`'s
 * `handleChunkTransportMessage`, `CarrierRelay.js`'s
 * `handleCarrierRelayMessage`, `DhtTransport.js`'s `handleDhtMessage` — all
 * follow the same `(peerId, op) => boolean` "handled?" chaining pattern).
 * Handlers are tried in registration order; the first one that returns
 * `true` consumes the message.
 * @returns {() => void} unsubscribe function
 */
export function addSessionOpHandler(session, handlerFn) {
  if (typeof handlerFn !== 'function') throw new TypeError('session op handler must be a function');
  session._handlers.add(handlerFn);
  return () => session._handlers.delete(handlerFn);
}

/** Register a bounded, version-aware route protocol handler. */
export function registerSessionProtocol(session, descriptor) {
  const release = registerRouteProtocol(session.protocolRegistry, descriptor);
  if (!session._destroyed && session.core) broadcastOp(session.core, createRouteProtocolCatalogOp(session.protocolRegistry));
  return () => {
    const removed = release();
    if (removed && !session._destroyed && session.core) {
      broadcastOp(session.core, createRouteProtocolCatalogOp(session.protocolRegistry));
    }
    return removed;
  };
}

/** This session's `sendToPeer(peerId, data)` — the exact shape ChunkTransport/CarrierRelay/DhtTransport expect. */
export function sessionSendToPeer(session, peerId, data) {
  return collabSendToPeer(session.core, peerId, data);
}

/** Send a versioned protocol envelope, optionally requiring peer advertisement. */
export function sessionSendProtocol(session, peerId, data, { requireAdvertised = false } = {}) {
  assertKnownProtocol(data);
  const supported = peerSupportsRouteProtocol(session.protocolRegistry, peerId, data.protocol);
  if (supported === false || (supported == null && requireAdvertised)) return false;
  return collabSendToPeer(session.core, peerId, data);
}

/** Broadcast one application op to every connected direct mesh neighbor. */
export function sessionBroadcast(session, data) {
  return broadcastOp(session.core, data);
}

/** Broadcast a versioned envelope only to compatible or pre-catalog peers. */
export function sessionBroadcastProtocol(session, data, { requireAdvertised = false } = {}) {
  assertKnownProtocol(data);
  let sent = 0;
  for (const peerId of sessionPeerIds(session)) {
    if (sessionSendProtocol(session, peerId, data, { requireAdvertised })) sent++;
  }
  return sent;
}

/** Connected peer IDs for routing and role coordination. */
export function sessionPeerIds(session) {
  return [...getPeers(session.core)].filter(([, peer]) => peer.connected).map(([peerId]) => peerId);
}

/** Mesh topology stats for UI display (mode, neighbor count, supernode status, gossip counters). */
export function sessionTopologyStats(session) {
  return getTopologyStats(session.topology);
}

/** Locally measured, secret-free peer transport observations. */
export function sessionPeerMetrics(session) {
  return [...session._peerMetrics.values()].map((metrics) => Object.freeze({ ...metrics }));
}

/** Protocol catalog, peer negotiation, and bounded dispatch counters. */
export function sessionProtocolStatus(session) {
  return routeProtocolRegistryStatus(session.protocolRegistry);
}

/** Tear down a session's WebRTC connections, signaling, and topology timers. */
export function destroyOsNetworkSession(session) {
  session._destroyed = true;
  if (session._topologyTimer != null) {
    clearInterval(session._topologyTimer);
    session._topologyTimer = null;
  }
  try { broadcastGoodbye(session.core); } catch (_) { /* best-effort */ }
  destroyCollabCore(session.core);
  destroyMeshTopology(session.topology); // also stops the rebalance timer
  session._handlers.clear();
  session._peerMetrics.clear();
  session.protocolRegistry.descriptors.clear();
  session.protocolRegistry.peers.clear();
  session.protocolRegistry.stats.clear();
}
