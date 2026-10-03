// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

// network/identity/NetworkIdentity.js — profile/device/membership identity
// layer for the Particle Global OS Network Layer (network plan §11).
//
// The network plan keeps several identity levels distinct:
//   profile_id      stable user identity, portable across devices/groups
//   device_id       per-device identity used for route/session proofs
//   membership_id   per-group pseudonymous identity (unlinkable across groups)
//
// engine/state/authority/Identity.js already wraps CollabIdentity (ECDSA
// P-256) as a generic `createSigner(principal)`, and now mints a SEPARATE
// persisted keypair per distinct principal string (Phase 0 audit finding —
// no new crypto, just named keys). This module is a thin, semantically-named
// layer on top of that: each helper below is just `createSigner()` with a
// principal string that encodes the identity level.

import { createSigner, verifyWithKey } from '../../state/authority/Identity.js';
import {
  REALM_ID_TYPE,
  createKeyControlledRealmId,
  realmKeyFingerprint,
} from '../realm/addressing/RealmIds.js';

let _profileIdentityProvider = null;

/**
 * Bind the OS ProfileDriver as the canonical profile/Passport identity owner.
 * The engine retains its named-key fallback for standalone demos and tests, but
 * an initialized OS always resolves the active profile through this provider.
 */
export function bindProfileIdentityProvider(provider) {
  if (provider !== null && typeof provider?.getPassportSigner !== 'function') {
    throw new TypeError('profile identity provider must expose getPassportSigner()');
  }
  _profileIdentityProvider = provider;
  return () => {
    if (_profileIdentityProvider === provider) _profileIdentityProvider = null;
  };
}

async function withStableIdentity(signer, type) {
  if (!signer?.secure || !signer.publicKeyHex) return signer;
  const fingerprint = await realmKeyFingerprint(signer.publicKeyHex);
  const realmId = await createKeyControlledRealmId(type, signer.publicKeyHex);
  return Object.freeze({
    ...signer,
    legacyFingerprint: signer.fingerprint,
    fingerprint,
    realmId,
  });
}

/**
 * This device's per-device signer — used for low-level route/session proofs
 * with a Masterserver (HELLO/PROVE). Never used as group identity.
 * @returns {Promise<object>} signer { principal, fingerprint, publicKeyHex, secure, sign, verify }
 */
export async function createDeviceIdentity() {
  const signer = await withStableIdentity(await createSigner('device'), REALM_ID_TYPE.DEVICE);
  if (signer?.secure && _profileIdentityProvider?.ensureDeviceGrant) {
    try {
      const deviceGrant = await _profileIdentityProvider.ensureDeviceGrant({
        deviceId: signer.realmId,
        publicKeyHex: signer.publicKeyHex,
        label: 'Realm Network device',
        scopes: ['realm.connect', 'realm.sync', 'realm.presence'],
      });
      return Object.freeze({ ...signer, deviceGrant });
    } catch (error) {
      console.warn('[NetworkIdentity] Passport device authorization failed:', error?.message);
    }
  }
  return signer;
}

/**
 * This user's stable profile signer. One profile per logical user on this
 * device (multiple profiles are supported by passing distinct `profileId`s,
 * e.g. for multi-account testing) — each gets its own persisted keypair.
 * @param {string} [profileId='default']
 * @returns {Promise<object>} signer
 */
export async function createProfileIdentity(profileId = 'default') {
  if (_profileIdentityProvider) {
    try {
      const signer = await _profileIdentityProvider.getPassportSigner(profileId);
      if (signer) return signer;
      console.warn('[NetworkIdentity] No active Realm Passport; profile identity is unavailable');
      return null;
    } catch (error) {
      console.warn('[NetworkIdentity] Passport signer unavailable:', error?.message);
      return null;
    }
  }
  return withStableIdentity(await createSigner(`profile:${String(profileId)}`), REALM_ID_TYPE.USER);
}

/**
 * A per-group pseudonymous membership signer for a profile. Distinct
 * keypair per (profileId, groupId) pair, so a member's participation in one
 * group cannot be linked to their participation in another, or to their
 * underlying profile, by key alone.
 * @param {string} profileId
 * @param {string} groupId
 * @returns {Promise<object>} signer
 */
export async function createMembershipIdentity(profileId, groupId) {
  if (!profileId) throw new TypeError('createMembershipIdentity requires a profileId');
  if (!groupId) throw new TypeError('createMembershipIdentity requires a groupId');
  return withStableIdentity(
    await createSigner(`membership:${String(groupId)}:${String(profileId)}`),
    REALM_ID_TYPE.MEMBERSHIP,
  );
}

/**
 * Derive a stable "peer id" string for use in route tables / mesh topology
 * from any signer's fingerprint (device, profile, or membership signer).
 * @param {object} signer
 * @returns {string}
 */
export function peerIdFromSigner(signer) {
  return String(signer?.fingerprint ?? '');
}

/** Full SHA-256 public-key fingerprint used by Realm Network identities. */
export const computeFingerprint = realmKeyFingerprint;

export { verifyWithKey };
