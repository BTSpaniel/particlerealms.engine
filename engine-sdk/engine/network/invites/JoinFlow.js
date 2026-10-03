// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

// network/invites/JoinFlow.js — invite -> temp route -> mutual identity
// proof exchange -> group policy check (network plan §13 invite pipeline).
//
// This module only establishes "this join request is a genuine, signed
// response to a live, unconsumed invite" — it does NOT decide group policy
// (vote thresholds, founder approval, etc). That decision belongs to
// GroupLedger.proposeGroupEvent('MEMBER_ADDED', ...); once that commits, call
// grantJoinCapability() to actually let the new member attach to the group's
// real route.

import { makeEnvelope, signEnvelope, verifyEnvelope, PROTOCOL_VERSIONS } from '../protocol.js';
import { verifyInvite, isInviteConsumed, consumeInvite } from './InvitePacket.js';
import { makeRouteCapability, ROUTE_ACTIONS } from '../capability/RouteCapability.js';

/**
 * Joiner side: build a signed join request referencing a (decoded) invite.
 * @param {object} c
 * @param {object} c.signedInvite  decoded invite envelope (from decodeInvite())
 * @param {object} c.joinerSigner  the joiner's signer (their real principal)
 * @returns {Promise<object>} signed JOIN_REQUESTED envelope
 */
export async function requestJoin({ signedInvite, joinerSigner } = {}) {
  if (!signedInvite) throw new TypeError('requestJoin requires a signedInvite');
  if (!joinerSigner) throw new TypeError('requestJoin requires a joinerSigner');
  const env = makeEnvelope({
    protocol: PROTOCOL_VERSIONS.INVITE,
    type: 'JOIN_REQUESTED',
    payload: {
      inviteId: signedInvite.payload.inviteId,
      groupId: signedInvite.payload.groupId,
      joinerPrincipal: joinerSigner.principal,
      joinerPublicKeyHex: joinerSigner.publicKeyHex,
    },
  });
  return signEnvelope(env, joinerSigner);
}

/**
 * Inviter/group side: validate an invite together with a join request
 * responding to it.
 * @returns {Promise<{ ok:boolean, reason:string|null, joinerPrincipal?:string, joinerPublicKeyHex?:string, groupId?:string, roleOffer?:string }>}
 */
export async function verifyJoinRequest({ signedInvite, joinRequest, inviteRegistry = null, now = Date.now() } = {}) {
  const inviteVerdict = await verifyInvite(signedInvite, { now });
  if (!inviteVerdict.ok) return { ok: false, reason: `invite:${inviteVerdict.reason}` };
  if (inviteRegistry && isInviteConsumed(inviteRegistry, signedInvite.payload.inviteId)) {
    return { ok: false, reason: 'invite-already-consumed' };
  }
  if (!joinRequest || joinRequest.payload?.inviteId !== signedInvite.payload.inviteId) {
    return { ok: false, reason: 'invite-mismatch' };
  }
  const reqOk = await verifyEnvelope(joinRequest);
  if (!reqOk) return { ok: false, reason: 'bad-join-request-signature' };
  return {
    ok: true,
    reason: null,
    joinerPrincipal: joinRequest.payload.joinerPrincipal,
    joinerPublicKeyHex: joinRequest.payload.joinerPublicKeyHex,
    groupId: signedInvite.payload.groupId,
    roleOffer: signedInvite.payload.roleOffer,
  };
}

/**
 * After the group has approved the join (GroupLedger MEMBER_ADDED commit),
 * mint the new member's first route capability for the group's real route
 * and consume the invite if it was one-time.
 * @param {object} c
 * @param {object} c.signedInvite
 * @param {string} c.joinerPrincipal
 * @param {string} c.groupRouteId   the group's real (post-join) route id
 * @param {object} [c.inviteRegistry]
 * @param {string[]} [c.allow]      default: attach+subscribe+publish
 * @returns {object} frozen route capability for the joiner
 */
export function grantJoinCapability({
  signedInvite, joinerPrincipal, groupRouteId, inviteRegistry = null,
  allow = [ROUTE_ACTIONS.ATTACH, ROUTE_ACTIONS.SUBSCRIBE, ROUTE_ACTIONS.PUBLISH],
} = {}) {
  if (!joinerPrincipal) throw new TypeError('grantJoinCapability requires joinerPrincipal');
  if (!groupRouteId) throw new TypeError('grantJoinCapability requires groupRouteId');
  const cap = makeRouteCapability({ principal: joinerPrincipal, routeId: groupRouteId, allow });
  if (inviteRegistry && signedInvite?.payload?.oneTime) {
    consumeInvite(inviteRegistry, signedInvite.payload.inviteId);
  }
  return cap;
}
