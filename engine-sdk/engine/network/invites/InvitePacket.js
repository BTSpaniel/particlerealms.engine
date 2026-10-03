// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

// network/invites/InvitePacket.js — signed, one-time, expiring invites
// (network plan §13).
//
// An invite is a doorway into a group's approval process, NOT automatic
// membership: it just names a temporary meeting route and a role offer, and
// is signed by the inviter so anyone can verify who issued it. It does not
// itself grant route/group access — that capability is minted only after
// the join-request identity exchange (see JoinFlow.js), once the joiner's
// real principal is known. "Base64 is not security" (network plan §13) — the
// encode/decode here is just a convenient transport, the actual guarantee is
// the ECDSA signature over the canonical envelope (protocol.js).

import { makeEnvelope, signEnvelope, verifyEnvelope, PROTOCOL_VERSIONS } from '../protocol.js';
import { byteSignature } from '../../core/math/FormatMath.js';

let _inviteSequence = 0;

function _randomSuffix() {
  const cryptoApi = globalThis.crypto;
  try {
    if (typeof cryptoApi?.randomUUID === 'function') {
      return cryptoApi.randomUUID().replaceAll('-', '').slice(0, 8);
    }
    if (typeof cryptoApi?.getRandomValues === 'function') {
      const bytes = new Uint8Array(4);
      cryptoApi.getRandomValues(bytes);
      return byteSignature(bytes);
    }
  } catch {}
  // Preserve invite creation in legacy insecure contexts without claiming entropy.
  const timePart = Date.now().toString(36).slice(-4).padStart(4, '0');
  const sequencePart = (++_inviteSequence).toString(36).padStart(4, '0').slice(-4);
  return timePart + sequencePart;
}

/**
 * Build + sign an invite packet.
 * @param {object} c
 * @param {string} c.groupId
 * @param {string} c.routeId        temporary meeting route where identities are exchanged
 * @param {string} [c.roleOffer='member']
 * @param {boolean} [c.oneTime=true]
 * @param {number} [c.expiresAt]    epoch ms; null = no expiry
 * @param {object} c.inviterSigner  from createMembershipIdentity()/createProfileIdentity()
 * @returns {Promise<object>} signed invite envelope
 */
export async function makeInvite({
  groupId, routeId, roleOffer = 'member', oneTime = true, expiresAt = null, inviterSigner,
} = {}) {
  if (!groupId) throw new TypeError('makeInvite requires a groupId');
  if (!routeId) throw new TypeError('makeInvite requires a routeId (temporary meeting route)');
  if (!inviterSigner) throw new TypeError('makeInvite requires an inviterSigner');
  const inviteId = `invite:${groupId}:${routeId}:${Date.now().toString(36)}:${_randomSuffix()}`;
  const env = makeEnvelope({
    protocol: PROTOCOL_VERSIONS.INVITE,
    type: 'INVITE_CREATED',
    payload: { inviteId, groupId, routeId, roleOffer, oneTime, expiresAt },
  });
  return signEnvelope(env, inviterSigner);
}

/** URL-safe base64 encoding of a signed invite envelope, for sharing as a code/link. */
export function encodeInvite(signedInvite) {
  const json = JSON.stringify(signedInvite);
  const b64 = btoa(unescape(encodeURIComponent(json)));
  return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** Decode an invite code back into its (still-UNVERIFIED) signed envelope. */
export function decodeInvite(inviteCode) {
  const b64 = String(inviteCode).replace(/-/g, '+').replace(/_/g, '/');
  const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4);
  const json = decodeURIComponent(escape(atob(padded)));
  return JSON.parse(json);
}

/**
 * Verify a decoded invite: known protocol/type, not expired, and the
 * signature actually matches the embedded inviter public key.
 * @returns {Promise<{ ok:boolean, reason:string|null }>}
 */
export async function verifyInvite(signedInvite, { now = Date.now() } = {}) {
  if (!signedInvite || signedInvite.protocol !== PROTOCOL_VERSIONS.INVITE || signedInvite.type !== 'INVITE_CREATED') {
    return { ok: false, reason: 'bad-protocol' };
  }
  const expiresAt = signedInvite.payload && signedInvite.payload.expiresAt;
  if (expiresAt != null && now > expiresAt) return { ok: false, reason: 'expired' };
  const sigOk = await verifyEnvelope(signedInvite);
  if (!sigOk) return { ok: false, reason: 'bad-signature' };
  return { ok: true, reason: null };
}

/** Create a registry to track which one-time invites have already been used. */
export function createInviteRegistry() {
  return { _consumed: new Set() };
}

export function isInviteConsumed(registry, inviteId) {
  return registry._consumed.has(inviteId);
}

export function consumeInvite(registry, inviteId) {
  registry._consumed.add(inviteId);
}
