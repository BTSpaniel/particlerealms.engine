// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

// state/authority/Identity.js — pluggable signer for the Authority plane (spec §12).
//
// Authority is explicit and bound to a signing key, not an ambient bearer token
// (spec rule 30, CSE rule 1). This wraps the engine's existing ECDSA P-256
// identity (engine/collab/CollabIdentity.js) behind a minimal signer interface
// so the commit coordinator can verify signatures at commit time. When
// SubtleCrypto is unavailable it degrades to a deterministic FNV stamp — usable
// for local dev, but `secure:false` flags that it carries no cryptographic
// guarantee.

import {
  createIdentity, signData, verifyData, computeFingerprint, isIdentityAvailable,
  signRawBytes, verifyRawBytes,
} from '../../collab/CollabIdentity.js';
import { byteSignature, hexToBytes as formatHexToBytes } from '../../core/math/FormatMath.js';
import { hashIdFast } from '../util/canonical.js';

function bytesToHex(bytes) {
  return byteSignature(bytes);
}

function hexToBytes(hex) {
  return formatHexToBytes(String(hex));
}

/**
 * Create an authority signer bound to a principal id.
 *
 * Each distinct principal gets its OWN persisted ECDSA P-256 keypair (via
 * CollabIdentity's named-key support) rather than sharing the single default
 * device key. This lets the same device host multiple unlinkable signers —
 * e.g. a stable `profile:<id>` identity and per-group pseudonymous
 * `membership:<groupId>:<profileId>` identities (engine/network/identity) —
 * without one leaking the other's fingerprint.
 * @param {string} principal  logical actor id (e.g. 'agent.builder', 'profile:alice')
 * @param {object} [opts]
 * @param {string} [opts.keyId]  explicit IndexedDB key id (defaults to `signer:<principal>`)
 * @param {boolean} [opts.persistent=true] false creates a memory-only identity
 * @param {boolean} [opts.requireSecure=false] reject noncryptographic fallback
 * @returns {Promise<object>} signer { principal, fingerprint, publicKeyHex, secure, sign, verify }
 */
export async function createSigner(principal, opts = {}) {
  const keyId = opts.keyId ?? `signer:${principal}`;
  const identity = await createIdentity(keyId, { persistent: opts.persistent });
  const secure = !!identity._available && isIdentityAvailable();
  if (opts.requireSecure === true && !secure) throw new Error('A secure ECDSA identity is required');
  const publicKeyHex = identity.publicKeyRaw?.length ? bytesToHex(identity.publicKeyRaw) : '';
  return Object.freeze({
    principal: String(principal),
    fingerprint: identity.fingerprint,
    publicKeyHex,
    secure,
    persistent: identity._persistent === true,
    /** Sign canonical data, returning a hex signature (or a fast stamp fallback). */
    async sign(data) {
      if (secure) {
        const sig = await signData(identity, String(data));
        return sig.length ? bytesToHex(sig) : null;
      }
      // Fallback: not cryptographic — a deterministic, fingerprint-bound stamp.
      return hashIdFast({ fp: identity.fingerprint, data: String(data) }, { schemaVersion: 'sig-fallback' });
    },
    /** Verify a hex signature against this signer's own public key. */
    async verify(data, signatureHex) {
      if (!secure) {
        const expect = hashIdFast({ fp: identity.fingerprint, data: String(data) }, { schemaVersion: 'sig-fallback' });
        return expect === signatureHex;
      }
      if (!publicKeyHex || !signatureHex) return false;
      return verifyData(hexToBytes(publicKeyHex), String(data), hexToBytes(signatureHex));
    },
    /**
     * Sign exact raw bytes (no stringification), returning a hex signature.
     * Needed for wire protocols that verify a signature over bytes they
     * issued directly (e.g. a Masterserver HELLO challenge).
     */
    async signRaw(bytes) {
      if (secure) {
        const sig = await signRawBytes(identity, bytes);
        return sig.length ? bytesToHex(sig) : null;
      }
      return hashIdFast({ fp: identity.fingerprint, data: bytesToHex(bytes) }, { schemaVersion: 'sig-fallback' });
    },
    /** Verify a hex signature over exact raw bytes against this signer's own public key. */
    async verifyRaw(bytes, signatureHex) {
      if (!secure) {
        const expect = hashIdFast({ fp: identity.fingerprint, data: bytesToHex(bytes) }, { schemaVersion: 'sig-fallback' });
        return expect === signatureHex;
      }
      if (!publicKeyHex || !signatureHex) return false;
      return verifyRawBytes(hexToBytes(publicKeyHex), bytes, hexToBytes(signatureHex));
    },
  });
}

/**
 * Verify a signature against an explicit public key (cross-actor verification).
 * @returns {Promise<boolean>}
 */
export async function verifyWithKey(publicKeyHex, data, signatureHex) {
  if (!publicKeyHex || !signatureHex) return false;
  try { return await verifyData(hexToBytes(publicKeyHex), String(data), hexToBytes(signatureHex)); }
  catch (_) { return false; }
}

export { computeFingerprint };
