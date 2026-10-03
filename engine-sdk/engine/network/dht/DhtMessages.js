// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

// network/dht/DhtMessages.js — future Particle DHT message primitives
// (network plan §47): FIND_PEER / FIND_ROUTE / FIND_PROVIDERS / PEER_EXCHANGE
// / ANNOUNCE_PROVIDER / ANNOUNCE_ROUTE. Low priority per the plan — these are
// just versioned envelope builders (protocol.js `particle-dht/1`) for a
// future real DHT transport; no network code lives here yet. Bootstrap is
// still required even with a DHT (network plan §47: cached peers/LAN/master
// server/invite) — see BootstrapSource.js.

import { makeEnvelope, PROTOCOL_VERSIONS } from '../protocol.js';

export function makeFindPeerMessage({ targetPeerId, requesterPeerId } = {}) {
  if (!targetPeerId) throw new TypeError('makeFindPeerMessage requires targetPeerId');
  return makeEnvelope({ protocol: PROTOCOL_VERSIONS.DHT, type: 'FIND_PEER', payload: { targetPeerId, requesterPeerId } });
}

export function makeFindRouteMessage({ routeId, requesterPeerId } = {}) {
  if (!routeId) throw new TypeError('makeFindRouteMessage requires routeId');
  return makeEnvelope({ protocol: PROTOCOL_VERSIONS.DHT, type: 'FIND_ROUTE', payload: { routeId, requesterPeerId } });
}

export function makeFindProvidersMessage({ key, requesterPeerId } = {}) {
  if (!key) throw new TypeError('makeFindProvidersMessage requires key');
  return makeEnvelope({ protocol: PROTOCOL_VERSIONS.DHT, type: 'FIND_PROVIDERS', payload: { key, requesterPeerId } });
}

export function makeAnnounceProviderMessage({ key, peerId, ttlMs } = {}) {
  if (!key || !peerId) throw new TypeError('makeAnnounceProviderMessage requires key and peerId');
  return makeEnvelope({ protocol: PROTOCOL_VERSIONS.DHT, type: 'ANNOUNCE_PROVIDER', payload: { key, peerId, ttlMs } });
}

export function makeAnnounceRouteMessage({ routeId, peerId, services = [], ttlMs } = {}) {
  if (!routeId || !peerId) throw new TypeError('makeAnnounceRouteMessage requires routeId and peerId');
  return makeEnvelope({ protocol: PROTOCOL_VERSIONS.DHT, type: 'ANNOUNCE_ROUTE', payload: { routeId, peerId, services: [...services], ttlMs } });
}

export function makePeerExchangeMessage({ knownPeers = [] } = {}) {
  return makeEnvelope({ protocol: PROTOCOL_VERSIONS.DHT, type: 'PEER_EXCHANGE', payload: { knownPeers: [...knownPeers] } });
}
