// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

// network/carrier/CarrierForwarder.js — the forwarding decision a carrier
// node makes for a sealed packet, WITHOUT ever inspecting its payload
// (network plan §24/§35/§36): expiry, hop-limit (TTL), dedupe, and rate
// limit, in that order. Reuses `chunks/DedupeCache.js` as-is (network plan
// §29 dedupe applies uniformly to control/route/carrier traffic).

import { isCarrierPacketExpired, isCarrierTtlExhausted, decrementCarrierTtl } from './CarrierPacket.js';
import { checkAndMark } from '../chunks/DedupeCache.js';
import { tryConsume } from './RateLimiter.js';

function _dedupeKeyFor(packet) {
  const channelId = packet.payload.sealed && packet.payload.sealed.channelId;
  const channelKey = channelId && typeof channelId.join === 'function' ? channelId.join(',') : String(channelId);
  return `carrier:${packet.payload.routeId}:${channelKey}`;
}

/**
 * Decide whether to forward a carrier packet.
 * @param {object} c
 * @param {object} c.packet          from makeCarrierPacket()
 * @param {object} c.dedupeCache     from createDedupeCache()
 * @param {object} c.rateLimiter     from createRateLimiter()
 * @param {number} [c.dedupeTtlMs=60000]
 * @param {number} [c.now]
 * @returns {{ forward:boolean, reason:string|null, packet?:object }}
 */
export function evaluateForward({ packet, dedupeCache, rateLimiter, dedupeTtlMs = 60000, now = Date.now() } = {}) {
  if (isCarrierPacketExpired(packet, now)) return { forward: false, reason: 'expired' };
  if (isCarrierTtlExhausted(packet)) return { forward: false, reason: 'ttl-exhausted' };
  if (!checkAndMark(dedupeCache, _dedupeKeyFor(packet), dedupeTtlMs, now)) return { forward: false, reason: 'duplicate' };
  if (!tryConsume(rateLimiter, 1, now)) return { forward: false, reason: 'rate-limited' };
  return { forward: true, reason: null, packet: decrementCarrierTtl(packet) };
}
