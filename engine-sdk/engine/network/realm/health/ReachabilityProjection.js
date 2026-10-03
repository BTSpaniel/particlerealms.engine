// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

export const ENDPOINT_REACHABILITY = Object.freeze({
  OFFLINE: 'offline',
  LOCAL: 'local',
  RENDEZVOUS: 'rendezvous',
  RELAY: 'relay',
  DIRECT: 'direct',
});

/** Build a secret-free reachability projection from locally observed evidence. */
export function projectEndpointReachability({
  residentActive = false,
  routeCount = 0,
  masterservers = [],
  peers = [],
  observedAt = Date.now(),
} = {}) {
  const connectedPeers = (Array.isArray(peers) ? peers : []).filter((peer) => peer?.connected === true);
  const directPeers = connectedPeers.filter((peer) => peer.relayed === false).length;
  const relayedPeers = connectedPeers.filter((peer) => peer.relayed === true).length;
  const rendezvousServers = (Array.isArray(masterservers) ? masterservers : []).filter((server) => (
    ['connected', 'ready', 'authenticated', 'proven'].includes(String(server?.state ?? '').toLowerCase())
  )).length;
  const state = directPeers > 0
    ? ENDPOINT_REACHABILITY.DIRECT
    : relayedPeers > 0
      ? ENDPOINT_REACHABILITY.RELAY
      : rendezvousServers > 0
        ? ENDPOINT_REACHABILITY.RENDEZVOUS
        : residentActive || routeCount > 0
          ? ENDPOINT_REACHABILITY.LOCAL
          : ENDPOINT_REACHABILITY.OFFLINE;
  return Object.freeze({
    state,
    observedAt: Number(observedAt),
    evidence: Object.freeze({
      connectedPeers: connectedPeers.length,
      directPeers,
      relayedPeers,
      rendezvousServers,
      residentActive: residentActive === true,
      routeCount: Math.max(0, Number(routeCount) || 0),
    }),
  });
}

