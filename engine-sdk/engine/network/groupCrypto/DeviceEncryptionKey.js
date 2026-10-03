// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

// network/groupCrypto/DeviceEncryptionKey.js — per-device ECDH encryption
// keypair used to receive group welcome packets (network plan §14).
//
// This is intentionally SEPARATE from the ECDSA signing identities in
// engine/network/identity/NetworkIdentity.js: signing proves "who you are";
// this key only exists so other members can encrypt an epoch key TO this
// specific device. Reuses engine/collab/CollabCrypto.js's ECDH P-256
// primitives (the same ones used for peer-to-peer session encryption).

import { generateKeyPair } from '../../collab/CollabCrypto.js';

/**
 * Generate a fresh ECDH P-256 keypair for this device to receive welcome
 * packets. Ephemeral by design (network plan §14 "per-device public
 * encryption keys") — callers that need persistence should store
 * `publicKeyRaw`/export the private key themselves via their own storage.
 * @returns {Promise<{publicKey:CryptoKey, privateKey:CryptoKey, publicKeyRaw:ArrayBuffer}>}
 */
export async function createDeviceEncryptionKeyPair() {
  return generateKeyPair();
}
