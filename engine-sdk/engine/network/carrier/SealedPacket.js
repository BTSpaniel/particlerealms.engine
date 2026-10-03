// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

// network/carrier/SealedPacket.js — multi-hop onion-sealed packets (network
// plan §24/§26 public carrier layer).
//
// Phase 0 audit finding: `engine/collab/CollabAnonymousRelay.js` implements
// SINGLE-hop anonymization (host relay + garlic-encrypted payload) for one
// game-collab session. The OS network layer needs TRUE multi-hop onion
// routing across semi-trusted carrier meshes that are not part of any
// group. This module builds that generically, reusing the same ECDH P-256 +
// AES-256-GCM primitives (`CollabCrypto`) rather than inventing new crypto.
//
// Each layer is wrapped from the innermost (final recipient) outward, so
// only the addressed hop can decrypt its own layer. A peeled layer reveals
// only the NEXT hop's peerId (or, at the final layer, the actual payload) —
// never the full path, the true sender, or the payload, matching §26.

import {
  generateKeyPair, importPublicKey, deriveSharedKey, encrypt as ecdhEncrypt, decrypt as ecdhDecrypt,
} from '../../collab/CollabCrypto.js';

// A sealed layer's fields (senderEcdhPublicKeyRaw/channelId/ciphertext) are
// binary (ArrayBuffer/Uint8Array). When one sealed layer is embedded as the
// `inner` of an OUTER layer, that whole structure is JSON.stringify'd before
// encryption — and JSON silently mangles binary types (an ArrayBuffer
// becomes `{}`, a Uint8Array becomes an index-keyed plain object). So any
// nested (non-innermost) layer must be base64-encoded before embedding, and
// decoded back after parsing, or every hop past the first would fail to
// decrypt with corrupted key/ciphertext bytes.

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

function _encodeLayerForEmbedding(sealed) {
  return {
    senderEcdhPublicKeyRaw: _bytesToBase64(sealed.senderEcdhPublicKeyRaw),
    channelId: _bytesToBase64(sealed.channelId),
    ciphertext: _bytesToBase64(sealed.ciphertext),
  };
}

function _decodeEmbeddedLayer(encoded) {
  return {
    senderEcdhPublicKeyRaw: _base64ToBytes(encoded.senderEcdhPublicKeyRaw),
    channelId: _base64ToBytes(encoded.channelId),
    ciphertext: _base64ToBytes(encoded.ciphertext),
  };
}

async function _sealLayer(layerPlaintext, recipientEcdhPublicKeyRaw) {
  const sender = await generateKeyPair();
  const recipientPublicKey = await importPublicKey(recipientEcdhPublicKeyRaw);
  const sharedKey = await deriveSharedKey(sender.privateKey, recipientPublicKey);
  const plaintextBytes = new TextEncoder().encode(JSON.stringify(layerPlaintext));
  const channelId = crypto.getRandomValues(new Uint8Array(8));
  const ciphertext = await ecdhEncrypt(sharedKey, plaintextBytes, 0, channelId);
  return { senderEcdhPublicKeyRaw: sender.publicKeyRaw, channelId, ciphertext };
}

/**
 * Build a multi-hop sealed packet.
 * @param {object} c
 * @param {Array<{ peerId:string, ecdhPublicKeyRaw:ArrayBuffer|Uint8Array }>} c.hops
 *        ordered first-hop -> final-recipient
 * @param {*} c.payload  JSON-serializable final payload
 * @returns {Promise<object>} the outer sealed layer, addressed to hops[0]
 */
export async function buildSealedPacket({ hops, payload } = {}) {
  if (!Array.isArray(hops) || hops.length === 0) throw new TypeError('buildSealedPacket requires at least one hop');
  let inner = { final: true, payload };
  for (let i = hops.length - 1; i >= 0; i--) {
    const nextHopPeerId = i + 1 < hops.length ? hops[i + 1].peerId : null;
    const innerForJson = inner.final ? inner : _encodeLayerForEmbedding(inner);
    inner = await _sealLayer({ nextHopPeerId, inner: innerForJson }, hops[i].ecdhPublicKeyRaw);
  }
  return inner;
}

/**
 * Peel one layer with this hop's ECDH private key.
 * @returns {Promise<{done:false, nextHopPeerId:string, forward:object} | {done:true, payload:*} | null>}
 *          null (fails closed) if this layer wasn't addressed to this key / was tampered with.
 */
export async function peelSealedPacket(sealedLayer, recipientPrivateKey) {
  try {
    const senderPublicKey = await importPublicKey(sealedLayer.senderEcdhPublicKeyRaw);
    const sharedKey = await deriveSharedKey(recipientPrivateKey, senderPublicKey);
    const plaintextBytes = await ecdhDecrypt(sharedKey, sealedLayer.ciphertext, sealedLayer.channelId);
    const layer = JSON.parse(new TextDecoder().decode(plaintextBytes));
    if (layer.inner && layer.inner.final) return { done: true, payload: layer.inner.payload };
    return { done: false, nextHopPeerId: layer.nextHopPeerId, forward: _decodeEmbeddedLayer(layer.inner) };
  } catch (_) {
    return null;
  }
}
