// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

// network/groupCrypto/GroupEpoch.js — MLS-inspired group encryption epochs
// (network plan §14 group security / §39 route+key rotation on removal).
//
// Each group has a sequence of "epochs"; each epoch has its own AES-256-GCM
// key. Content sealed under an epoch can only be opened by holders of that
// epoch's key. Removing a member rotates to a fresh epoch and CRYPTO-ERASES
// the old one (drops the key reference) so previously-sealed content stays
// unreadable to anyone who only has the new epoch's key — the removed
// member's copy of the old epoch key becomes useless going forward, and any
// FUTURE content is sealed under a key they never received.
//
// This deliberately builds directly on `engine/state/integrity/SecureCrypto.js`
// (raw AES-256-GCM primitives) rather than the higher-level
// `SecureRetentionManager` class: welcome packets need to export/re-wrap the
// raw epoch key material for a specific recipient's ECDH public key, and
// `SecureRetentionManager` does not expose its internal CryptoKey for
// export. The crypto-erase SEMANTICS (drop the key reference; GCM tamper
// detection) are identical to `SecureRetentionManager.cryptoErase()`.

import {
  generateAesKey, exportKeyRaw, importAesKey, aeadSeal, aeadOpen, secureCryptoAvailable,
} from '../../state/integrity/SecureCrypto.js';
import {
  generateKeyPair, importPublicKey, deriveSharedKey, encrypt as ecdhEncrypt, decrypt as ecdhDecrypt,
} from '../../collab/CollabCrypto.js';

function _aad(groupId, epoch) { return `${groupId}:epoch:${epoch}`; }

/**
 * Create an empty group crypto state (no epochs started yet).
 * @param {object} c
 * @param {string} c.groupId
 * @returns {object}
 */
export function createGroupCrypto({ groupId } = {}) {
  if (!groupId) throw new TypeError('createGroupCrypto requires a groupId');
  if (!secureCryptoAvailable()) throw new Error('createGroupCrypto: WebCrypto (SubtleCrypto) is unavailable');
  return {
    groupId,
    currentEpoch: 0,
    _epochs: new Map(), // epoch:number -> { key:CryptoKey|null, createdAt:number, erased:boolean }
  };
}

/** Start the next epoch with a fresh AES-256-GCM key. Returns the new epoch number. */
export async function startEpoch(gc) {
  const epoch = gc.currentEpoch + 1;
  const key = await generateAesKey();
  gc._epochs.set(epoch, { key, createdAt: Date.now(), erased: false });
  gc.currentEpoch = epoch;
  return epoch;
}

export function getCurrentEpoch(gc) { return gc.currentEpoch; }

/** True if `epoch` has no live key (never started here, or crypto-erased). */
export function isEpochErased(gc, epoch) {
  const e = gc._epochs.get(epoch);
  return !e || e.erased;
}

/**
 * Seal a plaintext string under a specific epoch's key.
 * @returns {Promise<{ groupId:string, epoch:number, iv:string, ciphertext:string }>}
 */
export async function sealForEpoch(gc, epoch, plaintext) {
  const e = gc._epochs.get(epoch);
  if (!e || e.erased) throw new Error(`sealForEpoch: no live key for epoch ${epoch}`);
  const { iv, ciphertext } = await aeadSeal(e.key, plaintext, _aad(gc.groupId, epoch));
  return { groupId: gc.groupId, epoch, iv, ciphertext };
}

/**
 * Open an envelope from `sealForEpoch`. Returns null (fails closed) if the
 * epoch's key is missing/erased, the group id doesn't match, or the GCM
 * authentication tag fails (tampering/wrong key).
 * @returns {Promise<string|null>}
 */
export async function openEnvelope(gc, envelope) {
  if (!envelope || envelope.groupId !== gc.groupId) return null;
  const e = gc._epochs.get(envelope.epoch);
  if (!e || e.erased) return null;
  return aeadOpen(e.key, envelope, _aad(gc.groupId, envelope.epoch));
}

/**
 * Rotate to a new epoch and crypto-erase the current one (network plan
 * §14/§39). Removed members keep whatever they already downloaded, but
 * cannot read anything sealed after the rotation, and (once their key
 * reference is dropped) cannot re-derive the old epoch's key either.
 * @returns {Promise<{ oldEpoch:number, newEpoch:number }>}
 */
export async function rotateEpoch(gc) {
  const oldEpoch = gc.currentEpoch;
  const oldEntry = gc._epochs.get(oldEpoch);
  if (oldEntry) { oldEntry.erased = true; oldEntry.key = null; }
  const newEpoch = await startEpoch(gc);
  return { oldEpoch, newEpoch };
}

// ── Welcome packets (network plan §14: "encrypted welcome packets") ─────────

/**
 * Build a welcome packet: an epoch's raw key, ECDH-wrapped to one
 * recipient's device encryption public key. Only that recipient's matching
 * private key can unwrap it.
 * @param {object} c
 * @param {object} c.gc                      sender's GroupCrypto (holds the epoch key)
 * @param {number} c.epoch
 * @param {ArrayBuffer|Uint8Array} c.recipientEcdhPublicKeyRaw  from createDeviceEncryptionKeyPair()
 * @returns {Promise<object>} welcome packet
 */
export async function makeWelcomePacket({ gc, epoch, recipientEcdhPublicKeyRaw } = {}) {
  const e = gc._epochs.get(epoch);
  if (!e || e.erased) throw new Error(`makeWelcomePacket: no live key for epoch ${epoch}`);
  const sender = await generateKeyPair();
  const recipientPublicKey = await importPublicKey(recipientEcdhPublicKeyRaw);
  const sharedKey = await deriveSharedKey(sender.privateKey, recipientPublicKey);
  const rawKeyBytes = await exportKeyRaw(e.key);
  const channelId = crypto.getRandomValues(new Uint8Array(8));
  const ciphertext = await ecdhEncrypt(sharedKey, rawKeyBytes, 0, channelId);
  return {
    groupId: gc.groupId,
    epoch,
    senderEcdhPublicKeyRaw: sender.publicKeyRaw,
    channelId,
    ciphertext,
  };
}

/**
 * Recipient side: unwrap a welcome packet with the matching device private
 * key and import the epoch's raw key into the recipient's own GroupCrypto
 * instance (so they can now `openEnvelope()` content sealed under it).
 * @returns {Promise<boolean>} true on success
 */
export async function openWelcomePacket({ gc, welcomePacket, recipientPrivateKey } = {}) {
  if (!welcomePacket || welcomePacket.groupId !== gc.groupId) return false;
  try {
    const senderPublicKey = await importPublicKey(welcomePacket.senderEcdhPublicKeyRaw);
    const sharedKey = await deriveSharedKey(recipientPrivateKey, senderPublicKey);
    const rawKeyBytes = await ecdhDecrypt(sharedKey, welcomePacket.ciphertext, welcomePacket.channelId);
    const key = await importAesKey(rawKeyBytes);
    gc._epochs.set(welcomePacket.epoch, { key, createdAt: Date.now(), erased: false });
    if (welcomePacket.epoch > gc.currentEpoch) gc.currentEpoch = welcomePacket.epoch;
    return true;
  } catch (_) {
    return false;
  }
}
