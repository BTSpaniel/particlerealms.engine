// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

// network/carrier/CarrierPacket.js — the carrier layer's OUTER envelope
// (network plan §26): visible routing metadata (route/ttl/expiry) plus an
// opaque sealed payload (SealedPacket.js) that carrier nodes forward without
// ever decrypting.

import { makeEnvelope, PROTOCOL_VERSIONS } from '../protocol.js';

/**
 * Wrap a sealed onion packet for carrier forwarding.
 * @param {object} c
 * @param {string} c.routeId
 * @param {number} [c.ttl=4]        max remaining hops (network plan §35)
 * @param {number} [c.expiresAt]
 * @param {object} c.sealed         from buildSealedPacket()/peelSealedPacket().forward
 */
export function makeCarrierPacket({ routeId, ttl = 4, expiresAt = null, sealed } = {}) {
  if (!routeId) throw new TypeError('makeCarrierPacket requires a routeId');
  if (!sealed) throw new TypeError('makeCarrierPacket requires a sealed onion packet');
  return makeEnvelope({
    protocol: PROTOCOL_VERSIONS.CARRIER,
    type: 'CARRIER_FORWARD',
    payload: { routeId, ttl, expiresAt, sealed },
  });
}

/** Return a new carrier packet with ttl decremented by 1 (does not mutate the input). */
export function decrementCarrierTtl(packet) {
  return { ...packet, payload: { ...packet.payload, ttl: packet.payload.ttl - 1 } };
}

export function isCarrierPacketExpired(packet, now = Date.now()) {
  return packet.payload.expiresAt != null && now > packet.payload.expiresAt;
}

export function isCarrierTtlExhausted(packet) {
  return packet.payload.ttl <= 0;
}
