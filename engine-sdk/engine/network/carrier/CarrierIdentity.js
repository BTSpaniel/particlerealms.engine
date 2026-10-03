// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

// network/carrier/CarrierIdentity.js — announces a node's carrier-layer
// (§26) ECDH onion-recipient public key to its current mesh peers. Closes
// the gap `CarrierRelay.js`'s own doc flagged: "another peer can only
// address this device as an onion hop if it learned the key out-of-band."
// This is that in-band announce: a tiny message sent over the SAME mesh
// session data channel (via `sendToPeer`, typically from `onPeerJoin`),
// cached locally so a future `SealedPacket.buildSealedPacket({hops,
// payload})` call can look up a hop's key without any prior out-of-band
// exchange.
//
// Deliberately NOT signed/verified against a stronger identity (e.g. the
// CSE profile/device signer) — WebRTC's own DTLS already authenticates
// "these bytes came from the peer this data channel is connected to"; the
// remaining trust question (should carrier packets even be routed through
// this specific peer) is a routing/reputation decision for the caller, not
// this module's job. `handleCarrierIdentityMessage` only checks that the
// announce's claimed peerId matches the channel it arrived on (fails closed
// on mismatch — either a bug or a spoof attempt).

import { PROTOCOL_VERSIONS } from '../protocol.js';

export const CARRIER_IDENTITY_MESSAGE_TYPE = 'CARRIER_IDENTITY_ANNOUNCE';

function _bytesToBase64(buf) {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

function _base64ToBytes(b64) {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/** Create an empty registry of peerId -> carrier-recipient ECDH public key. */
export function createCarrierIdentityRegistry() {
  return { _keys: new Map() }; // peerId -> { publicKeyRaw:Uint8Array, receivedAt:number }
}

/** Build the announce message to hand to a mesh session's `sendToPeer`. Returns null if this node has no key to announce. */
export function buildCarrierIdentityAnnounce(selfPeerId, ecdhPublicKeyRaw) {
  if (!selfPeerId || !ecdhPublicKeyRaw) return null;
  return {
    protocol: PROTOCOL_VERSIONS.CARRIER,
    type: CARRIER_IDENTITY_MESSAGE_TYPE,
    peerId: selfPeerId,
    ecdhPublicKeyBase64: _bytesToBase64(ecdhPublicKeyRaw),
  };
}

/**
 * Feed every relevant `onOp(peerId, op)` message through this, alongside
 * `ChunkTransport.js`/`CarrierRelay.js`/`DhtTransport.js`'s own handlers
 * (same `(peerId, op) => boolean` chaining pattern).
 * @returns {boolean} true if this message was a carrier-identity announce (handled)
 */
export function handleCarrierIdentityMessage(registry, fromPeerId, op) {
  if (!op || op.type !== CARRIER_IDENTITY_MESSAGE_TYPE) return false;
  if (op.peerId !== fromPeerId) return true; // claimed identity doesn't match the channel it arrived on — drop, fail closed
  try {
    const publicKeyRaw = _base64ToBytes(op.ecdhPublicKeyBase64);
    registry._keys.set(fromPeerId, { publicKeyRaw, receivedAt: Date.now() });
  } catch (_) { /* malformed announce — ignore */ }
  return true;
}

/** Look up a previously-announced peer's carrier-recipient ECDH public key (raw bytes), or null. */
export function lookupCarrierRecipientKey(registry, peerId) {
  return registry._keys.get(peerId)?.publicKeyRaw ?? null;
}

/** List peerIds this node has learned a carrier-recipient key for. */
export function listKnownCarrierRecipients(registry) {
  return [...registry._keys.keys()];
}

/** Forget a peer's announced key (e.g. on disconnect/leave). */
export function forgetCarrierRecipient(registry, peerId) {
  return registry._keys.delete(peerId);
}
