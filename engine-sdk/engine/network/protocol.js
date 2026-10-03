// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

// network/protocol.js — namespaced/versioned message envelopes for the
// Particle Global OS Network Layer (network plan §34).
//
// Every message on the network carries an explicit, versioned protocol
// namespace (e.g. `particle-route/1`). Unversioned or unrecognized protocol
// strings are rejected outright — this is what lets the wire format evolve
// (particle-route/2, ...) without silently misparsing old/foreign traffic.
//
// Canonical signing reuses the Causal State Engine's deterministic
// canonicalization (engine/state/util/canonical.js, RFC-8785-style) so that
// signed envelopes hash/verify identically regardless of key order or
// JS engine, and reuses CSE's cross-actor verification (verifyWithKey) so a
// receiver can verify a sender's signature from just their public key hex.

import { canonicalize } from '../state/util/canonical.js';
import { verifyWithKey } from '../state/authority/Identity.js';

/** All known/versioned protocol namespaces (network plan §34). */
export const PROTOCOL_VERSIONS = Object.freeze({
  DISCOVERY: 'particle-discovery/1',
  SESSION: 'particle-session/1',
  ROUTE: 'particle-route/1',
  SIGNAL: 'particle-signal/1',
  CAPABILITY: 'particle-capability/1',
  INVITE: 'particle-invite/1',
  GROUP_LEDGER: 'particle-group-ledger/1',
  GROUP_CRYPTO: 'particle-group-crypto/1',
  SYNC: 'particle-sync/1',
  CHUNK: 'particle-chunk/1',
  WORKSTATION: 'particle-workstation/1',
  CARRIER: 'particle-carrier/1',
  DHT: 'particle-dht/1',
  PEER_TICKET: 'particle-peer-ticket/1',
  MANIFEST: 'particle-manifest/1',
  PACKET: 'particle-packet/1',
  NETWORK: 'particle-network/1',
  SESSION_V2: 'particle-session/2',
  ROUTE_V2: 'particle-route/2',
  SIGNAL_V2: 'particle-signal/2',
  NODE: 'particle-node/1',
  STATE_CHANNEL: 'particle-state-channel/1',
});

const KNOWN_PROTOCOLS = new Set(Object.values(PROTOCOL_VERSIONS));

/** True when `protocol` is one of this build's known, versioned namespaces. */
export function isKnownProtocol(protocol) {
  return typeof protocol === 'string' && KNOWN_PROTOCOLS.has(protocol);
}

/**
 * Build an unsigned protocol envelope. Throws if `protocol` isn't a known,
 * versioned namespace (spec §34 rule: reject unversioned packets).
 * @param {object} e
 * @param {string} e.protocol   one of PROTOCOL_VERSIONS
 * @param {string} e.type       message type (e.g. 'ATTACH_ROUTE', 'HELLO')
 * @param {*} [e.payload]       JSON-canonicalizable body
 * @param {object} [e.extra]    additional top-level fields (routeId, ttl, expiresAt, ...)
 * @returns {object} frozen unsigned envelope
 */
export function makeEnvelope({ protocol, type, payload = null, extra = {} } = {}) {
  if (!isKnownProtocol(protocol)) {
    throw new TypeError(`network protocol: unknown/unversioned protocol namespace "${protocol}"`);
  }
  if (!type) throw new TypeError('network protocol: envelope requires a type');
  return Object.freeze({
    protocol,
    type: String(type),
    issuedAt: Date.now(),
    payload,
    ...extra,
  });
}

/**
 * Assert an inbound (possibly untrusted) message is a well-formed envelope
 * with a known protocol namespace. Does NOT verify signatures — see
 * `verifyEnvelope`. Throws on failure so callers fail closed.
 * @returns {object} the same message, for chaining
 */
export function assertKnownProtocol(msg) {
  if (!msg || typeof msg !== 'object') throw new TypeError('network protocol: message must be an object');
  if (!isKnownProtocol(msg.protocol)) {
    throw new TypeError(`network protocol: rejected unversioned/unknown protocol "${msg && msg.protocol}"`);
  }
  if (!msg.type) throw new TypeError('network protocol: rejected message with no type');
  return msg;
}

/**
 * Sign an envelope with a CSE authority signer (engine/state/authority/Identity.js
 * `createSigner`, itself bound to a CollabIdentity ECDSA P-256 keypair).
 * The signature covers the canonical bytes of the envelope BEFORE the
 * signature/signerFingerprint fields exist, so verification reconstructs the
 * same canonical body by stripping those two fields back off.
 * @param {object} envelope  from makeEnvelope()
 * @param {object} signer    from createSigner()/network identity helpers
 * @returns {Promise<object>} frozen signed envelope
 */
export async function signEnvelope(envelope, signer) {
  if (!signer || typeof signer.sign !== 'function') throw new TypeError('signEnvelope requires a signer with .sign()');
  const body = canonicalize(envelope);
  const signature = await signer.sign(body);
  return Object.freeze({
    ...envelope,
    signerFingerprint: signer.fingerprint,
    signerPublicKeyHex: signer.publicKeyHex,
    signature,
  });
}

/**
 * Verify a signed envelope. Pass either a `signer` (verifies against its own
 * key — same-principal round-trip) or nothing to verify against the
 * envelope's own embedded `signerPublicKeyHex` (cross-actor verification,
 * the normal case when receiving from a remote peer).
 * @param {object} signedEnvelope
 * @param {object} [signer]  optional signer to verify against instead of the embedded key
 * @returns {Promise<boolean>}
 */
export async function verifyEnvelope(signedEnvelope, signer = null) {
  if (!signedEnvelope || !signedEnvelope.signature) return false;
  const { signature, signerFingerprint, signerPublicKeyHex, ...unsigned } = signedEnvelope;
  const body = canonicalize(unsigned);
  if (signer) return signer.verify(body, signature);
  if (!signerPublicKeyHex) return false;
  return verifyWithKey(signerPublicKeyHex, body, signature);
}
