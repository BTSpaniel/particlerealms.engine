// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

// network/carrier/CarrierRelay.js — routes a CarrierPacket across a real
// mesh (network plan §24/§35/§36, previously deferred: "CollabMeshTopology
// gossip/fanout/TTL wiring for actual multi-peer carrier mesh topology").
//
// SealedPacket.js's onion path is an ordered peerId list chosen by the
// SENDER, but not every hop in that path is necessarily a live WebRTC
// neighbor of the previous hop — K-neighbor partial-mesh/supernode modes
// deliberately do NOT connect every peer to every peer (see
// engine/collab/CollabMeshTopology.js's header comment: "K-neighbor gossip
// mesh ... messages reach all N peers in ~log_K(N) hops"). This module
// bridges that gap:
//   - If the addressed next hop IS a direct neighbor right now, deliver
//     directly — cheapest path, one hop, no flood.
//   - Otherwise, gossip-flood the envelope via CollabMeshTopology's existing
//     TTL+dedupe fanout (`gossipWrap`/`gossipReceive`) so it propagates
//     through the mesh until it reaches a peer who either IS the target or
//     has it as a direct neighbor, at which point THAT peer delivers it
//     directly instead of re-flooding.
//
// Every touch of a carrier packet — direct delivery or gossip relay — always
// runs through `CarrierForwarder.evaluateForward()` first (onion-layer
// expiry/TTL/dedupe/rate-limit), independent of and in addition to the mesh
// gossip's OWN TTL/dedupe: gossip TTL bounds mesh hops for one flood
// attempt; carrier TTL bounds total onion hops end-to-end. Neither layer
// ever inspects the sealed payload itself (network plan §24's core
// guarantee) — only `peelSealedPacket`, called with THIS node's own private
// key when (and only when) this node is the addressed hop, can see anything
// beyond the next hop id.

import { getNeighborIds, gossipWrap, gossipReceive } from '../../collab/CollabMeshTopology.js';
import { evaluateForward } from './CarrierForwarder.js';
import { peelSealedPacket } from './SealedPacket.js';
import { makeCarrierPacket } from './CarrierPacket.js';
import { PROTOCOL_VERSIONS } from '../protocol.js';

export const CARRIER_RELAY_MESSAGE_TYPE = '__carrier_forward__';

function carrierRelayOp(packet, nextHopPeerId) {
  return { protocol: PROTOCOL_VERSIONS.CARRIER, type: CARRIER_RELAY_MESSAGE_TYPE, packet, nextHopPeerId };
}

/**
 * @param {object} c
 * @param {(peerId:string, data:object) => void} c.sendToPeer  e.g. `(peerId, data) => sendToPeer(core, peerId, data)`
 * @param {object} c.topology        from `createMeshTopology()`
 * @param {object} c.dedupeCache     from `createDedupeCache()` — carrier-layer dedupe (see CarrierForwarder.js), separate from the mesh's own gossip dedupe
 * @param {object} c.rateLimiter     from `createRateLimiter()`
 * @param {CryptoKey} [c.recipientEcdhPrivateKey]  this node's ECDH private key, if it can be an onion recipient/intermediate hop
 * @param {(payload:*) => void} [c.onPayloadReceived]  called with the final plaintext payload when THIS node is the packet's ultimate recipient
 * @returns {object} relay state
 */
export function createCarrierRelay({
  sendToPeer, topology, dedupeCache, rateLimiter,
  recipientEcdhPrivateKey = null, onPayloadReceived = () => {},
} = {}) {
  if (typeof sendToPeer !== 'function') throw new TypeError('createCarrierRelay requires a sendToPeer function');
  if (!topology) throw new TypeError('createCarrierRelay requires a topology (createMeshTopology())');
  return { sendToPeer, topology, dedupeCache, rateLimiter, recipientEcdhPrivateKey, onPayloadReceived };
}

/**
 * Send/relay a carrier packet toward its addressed next hop. Runs the
 * standard forwarding check first — a caller originating a brand-new packet
 * should still go through this (it's the same expiry/TTL/dedupe/rate-limit
 * gate every intermediate hop uses, applied uniformly per network plan §35).
 * @returns {{ forward:boolean, reason:string|null, delivered?:'direct'|'gossip' }}
 */
export function relayCarrierPacket(relay, nextHopPeerId, packet) {
  const verdict = evaluateForward({ packet, dedupeCache: relay.dedupeCache, rateLimiter: relay.rateLimiter });
  if (!verdict.forward) return verdict;

  const neighbors = getNeighborIds(relay.topology);
  if (neighbors.includes(nextHopPeerId)) {
    relay.sendToPeer(nextHopPeerId, carrierRelayOp(verdict.packet, nextHopPeerId));
    return { ...verdict, delivered: 'direct' };
  }

  // Not a direct neighbor right now — gossip-flood toward it through the mesh.
  const wrapped = gossipWrap(relay.topology, carrierRelayOp(verdict.packet, nextHopPeerId));
  for (const peerId of neighbors) relay.sendToPeer(peerId, wrapped);
  return { ...verdict, delivered: 'gossip' };
}

/**
 * Feed every relevant `onOp(peerId, op)` message through this (e.g. from
 * `createCollabCore({ onOp })`, alongside `ChunkTransport.js`'s own
 * `handleChunkTransportMessage` — both follow the same "return false if not
 * ours" chaining pattern). Handles: peeling a layer addressed to this node,
 * delivering the final payload, direct-hop forwarding, and mesh-gossip
 * re-forwarding.
 * @returns {Promise<boolean>} true if this message was a carrier-relay message (handled)
 */
export async function handleCarrierRelayMessage(relay, fromPeerId, op) {
  if (!op || op.type !== CARRIER_RELAY_MESSAGE_TYPE) return false;

  let innerOp = op;
  let targets = [];
  let forwardOp = null;

  if (op._gossip) {
    const result = gossipReceive(relay.topology, fromPeerId, op);
    if (!result.op) return true; // duplicate or TTL-exhausted at the MESH layer — dropped
    innerOp = result.op;
    targets = result.targets;
    forwardOp = result.forwardOp;
  }

  const { packet, nextHopPeerId } = innerOp;
  const verdict = evaluateForward({ packet, dedupeCache: relay.dedupeCache, rateLimiter: relay.rateLimiter });
  if (!verdict.forward) return true; // dropped at the CARRIER layer (expired/ttl-exhausted/duplicate/rate-limited)

  if (!nextHopPeerId || nextHopPeerId === relay.topology.selfId) {
    await _receiveAsAddressedHop(relay, verdict.packet);
    return true;
  }

  // Not addressed to us — help it along.
  const neighbors = getNeighborIds(relay.topology);
  if (neighbors.includes(nextHopPeerId)) {
    relay.sendToPeer(nextHopPeerId, carrierRelayOp(verdict.packet, nextHopPeerId));
  } else if (forwardOp && targets.length) {
    for (const peerId of targets) relay.sendToPeer(peerId, forwardOp);
  }
  // else: not a neighbor and no gossip targets (e.g. arrived via direct send
  // whose sender's topology view is stale) — nothing more this node can do.
  return true;
}

async function _receiveAsAddressedHop(relay, packet) {
  if (!relay.recipientEcdhPrivateKey) return; // this node can't be an onion hop — nothing to peel
  const peeled = await peelSealedPacket(packet.payload.sealed, relay.recipientEcdhPrivateKey);
  if (!peeled) return; // fails closed — not actually addressed to us, or tampered

  if (peeled.done) {
    relay.onPayloadReceived(peeled.payload);
    return;
  }

  const nextPacket = makeCarrierPacket({
    routeId: packet.payload.routeId,
    ttl: packet.payload.ttl,           // already decremented by evaluateForward's verdict
    expiresAt: packet.payload.expiresAt,
    sealed: peeled.forward,
  });
  relayCarrierPacket(relay, peeled.nextHopPeerId, nextPacket);
}
