// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

// network/peerTickets/PeerTicket.js — encrypted, remembered reconnect
// records (network plan §38).
//
// A peer ticket is a signed statement "peerId X is reachable, offers these
// services, at these route hints, valid until Y" — it lets a device
// reconnect to known peers/groups without the discovery server, once trust
// has already been established once. Sealing (encrypting the ticket itself)
// reuses the same ECDH-wrap pattern as group welcome packets
// (engine/network/groupCrypto/GroupEpoch.js), OR a group's current
// encryption epoch directly, per network plan §38 "encrypt to recipient
// device key OR group epoch key".

import { makeEnvelope, signEnvelope, verifyEnvelope, PROTOCOL_VERSIONS } from '../protocol.js';
import {
  generateKeyPair, importPublicKey, deriveSharedKey, encrypt as ecdhEncrypt, decrypt as ecdhDecrypt,
} from '../../collab/CollabCrypto.js';
import { sealForEpoch, openEnvelope as openEpochEnvelope } from '../groupCrypto/GroupEpoch.js';

/**
 * Build + sign a peer ticket.
 * @param {object} c
 * @param {string} c.peerId
 * @param {string} [c.deviceId]
 * @param {string} [c.profileId]
 * @param {string} [c.groupId]
 * @param {string[]} [c.services]      e.g. ['sync','chunks','workstation']
 * @param {string[]} [c.routeHints]    last-known opaque route ids
 * @param {number} [c.expiresAt]
 * @param {number} [c.routeEpoch]
 * @param {number} [c.encryptionEpoch]
 * @param {object} c.issuerSigner
 * @returns {Promise<object>} signed ticket envelope
 */
export async function makePeerTicket({
  peerId, deviceId = null, profileId = null, groupId = null,
  services = [], routeHints = [], expiresAt = null, routeEpoch = null, encryptionEpoch = null,
  issuerSigner,
} = {}) {
  if (!peerId) throw new TypeError('makePeerTicket requires a peerId');
  if (!issuerSigner) throw new TypeError('makePeerTicket requires an issuerSigner');
  const env = makeEnvelope({
    protocol: PROTOCOL_VERSIONS.PEER_TICKET,
    type: 'PEER_TICKET_ISSUED',
    payload: {
      peerId, deviceId, profileId, groupId,
      services: [...services], routeHints: [...routeHints],
      expiresAt, routeEpoch, encryptionEpoch,
    },
  });
  return signEnvelope(env, issuerSigner);
}

/**
 * Verify a peer ticket: known protocol/type, not expired, signature valid.
 * @returns {Promise<{ ok:boolean, reason:string|null }>}
 */
export async function verifyPeerTicket(signedTicket, { now = Date.now() } = {}) {
  if (!signedTicket || signedTicket.protocol !== PROTOCOL_VERSIONS.PEER_TICKET || signedTicket.type !== 'PEER_TICKET_ISSUED') {
    return { ok: false, reason: 'bad-protocol' };
  }
  const expiresAt = signedTicket.payload && signedTicket.payload.expiresAt;
  if (expiresAt != null && now > expiresAt) return { ok: false, reason: 'expired' };
  const sigOk = await verifyEnvelope(signedTicket);
  if (!sigOk) return { ok: false, reason: 'bad-signature' };
  return { ok: true, reason: null };
}

// ── Sealing option 1: to a specific recipient device key ────────────────────

/** ECDH-wrap a signed ticket so only the holder of `recipientEcdhPublicKeyRaw`'s private key can read it. */
export async function sealPeerTicketToDevice(signedTicket, recipientEcdhPublicKeyRaw) {
  const sender = await generateKeyPair();
  const recipientPublicKey = await importPublicKey(recipientEcdhPublicKeyRaw);
  const sharedKey = await deriveSharedKey(sender.privateKey, recipientPublicKey);
  const plaintext = new TextEncoder().encode(JSON.stringify(signedTicket));
  const channelId = crypto.getRandomValues(new Uint8Array(8));
  const ciphertext = await ecdhEncrypt(sharedKey, plaintext, 0, channelId);
  return { senderEcdhPublicKeyRaw: sender.publicKeyRaw, channelId, ciphertext };
}

/** Recipient side: unwrap a device-sealed ticket. Returns null (fails closed) on any error. */
export async function openSealedPeerTicket(sealed, recipientPrivateKey) {
  try {
    const senderPublicKey = await importPublicKey(sealed.senderEcdhPublicKeyRaw);
    const sharedKey = await deriveSharedKey(recipientPrivateKey, senderPublicKey);
    const plaintextBytes = await ecdhDecrypt(sharedKey, sealed.ciphertext, sealed.channelId);
    return JSON.parse(new TextDecoder().decode(plaintextBytes));
  } catch (_) {
    return null;
  }
}

// ── Sealing option 2: to a group's current encryption epoch ─────────────────

/** Seal a ticket under a group encryption epoch (readable by any member with that epoch's key). */
export async function sealPeerTicketToEpoch(groupCrypto, epoch, signedTicket) {
  return sealForEpoch(groupCrypto, epoch, JSON.stringify(signedTicket));
}

/** Open an epoch-sealed ticket. Returns null if the epoch key is missing/erased or tampered. */
export async function openSealedPeerTicketFromEpoch(groupCrypto, envelope) {
  const json = await openEpochEnvelope(groupCrypto, envelope);
  return json ? JSON.parse(json) : null;
}
