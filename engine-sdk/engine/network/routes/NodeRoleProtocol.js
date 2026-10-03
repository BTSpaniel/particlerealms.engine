// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

import { hexToBytes } from '../../core/math/FormatMath.js';
import { computeFingerprint } from '../identity/NetworkIdentity.js';
import { makeEnvelope, PROTOCOL_VERSIONS, signEnvelope, verifyEnvelope } from '../protocol.js';

export const NODE_ROLE_MESSAGE_TYPE = 'NODE_ROLE_ANNOUNCE';
export const NODE_ROLE_MAX_TTL_MS = 60_000;
const VALID_ROLES = new Set(['resident', 'supernode', 'witness', 'authority']);
const VALID_AVAILABILITY = new Set(['foreground', 'background', 'unavailable']);

function boundedStrings(values, allowed, maxItems) {
  if (!Array.isArray(values) || values.length > maxItems) throw new TypeError('invalid node role list');
  const unique = [...new Set(values.map(String))];
  if (unique.some(value => !allowed.has(value))) throw new TypeError('unknown node role value');
  return unique.sort();
}

/** Build a signed, expiring role announcement for one route. */
export async function signNodeRoleAnnouncement({
  routeId,
  nodeId,
  sequence,
  availability = 'foreground',
  roles = ['resident'],
  capabilities = [],
  ttlMs = NODE_ROLE_MAX_TTL_MS,
  signer,
  now = Date.now(),
} = {}) {
  if (!signer?.secure || !signer.publicKeyHex || typeof signer.sign !== 'function') {
    throw new Error('node role announcements require a secure device signer');
  }
  if (!routeId || !nodeId) throw new TypeError('node role announcement requires routeId and nodeId');
  if (!Number.isSafeInteger(sequence) || sequence <= 0) throw new RangeError('node role sequence must be positive');
  if (!VALID_AVAILABILITY.has(availability)) throw new TypeError('invalid node availability');
  if (!Number.isFinite(ttlMs) || ttlMs <= 0 || ttlMs > NODE_ROLE_MAX_TTL_MS) throw new RangeError('invalid node role ttl');
  const payload = Object.freeze({
    routeId: String(routeId),
    nodeId: String(nodeId),
    sequence,
    availability,
    roles: boundedStrings(roles, VALID_ROLES, VALID_ROLES.size),
    capabilities: [...new Set(capabilities.map(String))].filter(value => value.length > 0 && value.length <= 64).slice(0, 32).sort(),
    expiresAt: now + ttlMs,
  });
  return signEnvelope(makeEnvelope({
    protocol: PROTOCOL_VERSIONS.NODE,
    type: NODE_ROLE_MESSAGE_TYPE,
    payload,
    extra: { issuedAt: now },
  }), signer);
}

/** Verify signature, device-key binding, route scope, freshness, and ordering. */
export async function verifyNodeRoleAnnouncement(message, {
  routeId,
  peerId,
  lastSequence = 0,
  now = Date.now(),
  futureSkewMs = 30_000,
} = {}) {
  try {
    if (message?.protocol !== PROTOCOL_VERSIONS.NODE || message?.type !== NODE_ROLE_MESSAGE_TYPE) {
      return { ok: false, reason: 'bad-protocol' };
    }
    const payload = message.payload;
    if (!payload || payload.routeId !== routeId || payload.nodeId !== peerId || message.signerFingerprint !== peerId) {
      return { ok: false, reason: 'identity-or-scope' };
    }
    if (!Number.isSafeInteger(payload.sequence) || payload.sequence <= lastSequence) return { ok: false, reason: 'replay' };
    if (!Number.isFinite(message.issuedAt) || message.issuedAt > now + futureSkewMs
      || !Number.isFinite(payload.expiresAt) || payload.expiresAt <= now
      || payload.expiresAt - message.issuedAt > NODE_ROLE_MAX_TTL_MS) {
      return { ok: false, reason: 'stale-or-future' };
    }
    boundedStrings(payload.roles, VALID_ROLES, VALID_ROLES.size);
    if (!VALID_AVAILABILITY.has(payload.availability)) return { ok: false, reason: 'availability' };
    const fingerprint = await computeFingerprint(hexToBytes(message.signerPublicKeyHex));
    if (fingerprint !== peerId) return { ok: false, reason: 'key-binding' };
    if (!(await verifyEnvelope(message))) return { ok: false, reason: 'bad-signature' };
    return { ok: true, reason: null, value: Object.freeze({ ...payload, roles: Object.freeze([...payload.roles]) }) };
  } catch (_) {
    return { ok: false, reason: 'malformed' };
  }
}
