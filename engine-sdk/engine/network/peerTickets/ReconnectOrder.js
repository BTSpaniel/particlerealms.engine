// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

// network/peerTickets/ReconnectOrder.js — full device-boot reconnect order
// (network plan §38): cached peer tickets (freshest first) -> LAN -> group
// gossip -> master servers -> carrier -> DHT. Ties Phase 5 (peer tickets)
// onto Phase 2's `buildConnectionOrder` (routes/MasterServerList.js) without
// modifying it.

import { buildConnectionOrder } from '../routes/MasterServerList.js';
import { listPeerTicketsByFreshness } from './PeerTicketStore.js';

/**
 * @param {object} store        from createPeerTicketStore()
 * @param {object} normalizedMasterServerList  from normalizeMasterServerList()
 * @returns {Array<{ stage:string, peerId?:string, server?:object }>}
 */
export function buildPeerReconnectOrder(store, normalizedMasterServerList) {
  const ticketStages = listPeerTicketsByFreshness(store).map(({ peerId }) => ({ stage: 'peerTicket', peerId }));
  return [...ticketStages, ...buildConnectionOrder(normalizedMasterServerList)];
}
