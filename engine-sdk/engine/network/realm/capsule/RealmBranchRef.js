// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

import { canonicalBytes, hashIdSecure } from '../../../state/util/canonical.js';
import { verifyWithKey } from '../../../state/authority/Identity.js';
import { REALM_ID_TYPE, isRealmId, realmKeyFingerprint } from '../addressing/RealmIds.js';
import { REALM_BRANCH_REF_FORMAT, deepFreeze, isContentId } from './RealmCapsuleSchema.js';

const ROOT_DOMAIN = 'realm-branch-ref-root';
const SIGNING_DOMAIN = 'realm-branch-ref-signature';
const HEX = /^[0-9a-f]+$/;
const SECURE_ROOT = /^sha256:256:[0-9a-f]{64}$/;

function assertShape(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('RealmBranchRefV1 must be an object');
  const allowed = [
    'format', 'schemaVersion', 'realmId', 'branchId', 'capsuleRoot', 'chronicleRoot', 'sequence',
    'previousRefHash', 'issuedAt', 'signerFingerprint', 'signerPublicKeyHex', 'signature',
  ];
  for (const key of Object.keys(value)) if (!allowed.includes(key)) throw new TypeError(`RealmBranchRefV1 has unknown field ${key}`);
  if (value.format !== REALM_BRANCH_REF_FORMAT || value.schemaVersion !== 1) throw new TypeError('RealmBranchRefV1 format/version is invalid');
  if (!isRealmId(value.realmId, REALM_ID_TYPE.REALM)) throw new TypeError('RealmBranchRefV1 realmId is invalid');
  if (!isRealmId(value.branchId, REALM_ID_TYPE.BRANCH)) throw new TypeError('RealmBranchRefV1 branchId is invalid');
  if (!isContentId(value.capsuleRoot)) throw new TypeError('RealmBranchRefV1 capsuleRoot must be a SHA-256 content ID');
  if (typeof value.chronicleRoot !== 'string' || !SECURE_ROOT.test(value.chronicleRoot)) throw new TypeError('RealmBranchRefV1 chronicleRoot must be a CSE secure root');
  if (!Number.isSafeInteger(value.sequence) || value.sequence < 0) throw new TypeError('RealmBranchRefV1 sequence is invalid');
  if (value.previousRefHash !== null && (typeof value.previousRefHash !== 'string' || !SECURE_ROOT.test(value.previousRefHash))) throw new TypeError('RealmBranchRefV1 previousRefHash is invalid');
  if (!Number.isSafeInteger(value.issuedAt) || value.issuedAt < 0) throw new TypeError('RealmBranchRefV1 issuedAt is invalid');
  if (typeof value.signerFingerprint !== 'string' || !/^[0-9a-f]{64}$/.test(value.signerFingerprint)) throw new TypeError('RealmBranchRefV1 signerFingerprint is invalid');
  if (typeof value.signerPublicKeyHex !== 'string' || !/^04[0-9a-f]{128}$/.test(value.signerPublicKeyHex)) throw new TypeError('RealmBranchRefV1 signerPublicKeyHex is invalid');
  if (typeof value.signature !== 'string' || !HEX.test(value.signature) || value.signature.length < 128 || value.signature.length > 160 || value.signature.length % 2 !== 0) throw new TypeError('RealmBranchRefV1 signature is invalid');
  if (value.sequence === 0 && value.previousRefHash !== null) throw new TypeError('Initial RealmBranchRefV1 cannot have a previous ref');
  if (value.sequence > 0 && value.previousRefHash === null) throw new TypeError('Updated RealmBranchRefV1 requires a previous ref');
  return value;
}

function unsignedBody(value) {
  return {
    format: REALM_BRANCH_REF_FORMAT,
    schemaVersion: 1,
    realmId: value.realmId,
    branchId: value.branchId,
    capsuleRoot: value.capsuleRoot,
    chronicleRoot: value.chronicleRoot,
    sequence: value.sequence,
    previousRefHash: value.previousRefHash,
    issuedAt: value.issuedAt,
  };
}

export async function hashRealmBranchRef(ref) {
  assertShape(ref);
  return hashIdSecure(ref, { domain: ROOT_DOMAIN, schemaVersion: '1' });
}

export async function createRealmBranchRef(input, signer, previous = null) {
  if (!input || typeof input !== 'object') throw new TypeError('createRealmBranchRef requires input');
  if (!signer || typeof signer.sign !== 'function' || signer.secure !== true) throw new Error('Realm branch refs require a secure signer');
  if (!signer.fingerprint || !signer.publicKeyHex) throw new Error('Realm branch ref signer identity is incomplete');
  if (await realmKeyFingerprint(signer.publicKeyHex) !== signer.fingerprint) throw new Error('Realm branch ref signer fingerprint does not match its public key');
  if (previous) {
    const verifiedPrevious = await verifyRealmBranchRef(previous);
    if (!verifiedPrevious.ok) throw new Error(`Previous Realm branch ref is invalid: ${verifiedPrevious.reason}`);
    if (previous.realmId !== input.realmId || previous.branchId !== input.branchId) throw new Error('Previous Realm branch ref addresses a different branch');
  }
  const body = {
    format: REALM_BRANCH_REF_FORMAT,
    schemaVersion: 1,
    realmId: input.realmId,
    branchId: input.branchId,
    capsuleRoot: input.capsuleRoot,
    chronicleRoot: input.chronicleRoot,
    sequence: previous ? previous.sequence + 1 : 0,
    previousRefHash: previous ? await hashRealmBranchRef(previous) : null,
    issuedAt: input.issuedAt ?? Date.now(),
  };
  const signature = await signer.sign(canonicalBytes(body, { domain: SIGNING_DOMAIN, schemaVersion: '1' }));
  if (!signature) throw new Error('Realm branch ref signer did not produce a signature');
  const ref = deepFreeze({
    ...body,
    signerFingerprint: signer.fingerprint,
    signerPublicKeyHex: signer.publicKeyHex,
    signature,
  });
  assertShape(ref);
  return ref;
}

export async function verifyRealmBranchRef(ref, options = {}) {
  try {
    assertShape(ref);
    if (options.expectedSignerFingerprint && ref.signerFingerprint !== options.expectedSignerFingerprint) {
      return Object.freeze({ ok: false, reason: 'unexpected-signer' });
    }
    if (await realmKeyFingerprint(ref.signerPublicKeyHex) !== ref.signerFingerprint) {
      return Object.freeze({ ok: false, reason: 'signer-fingerprint-mismatch' });
    }
    if (options.previous) {
      const previous = options.previous;
      const previousVerification = await verifyRealmBranchRef(previous, {
        expectedSignerFingerprint: options.expectedSignerFingerprint,
      });
      if (!previousVerification.ok) return Object.freeze({ ok: false, reason: 'invalid-previous' });
      if (ref.realmId !== previous.realmId || ref.branchId !== previous.branchId) return Object.freeze({ ok: false, reason: 'branch-mismatch' });
      if (ref.sequence !== previous.sequence + 1) return Object.freeze({ ok: false, reason: 'sequence-mismatch' });
      if (ref.previousRefHash !== await hashRealmBranchRef(previous)) return Object.freeze({ ok: false, reason: 'previous-hash-mismatch' });
      if (ref.issuedAt < previous.issuedAt) return Object.freeze({ ok: false, reason: 'time-regression' });
    }
    const bytes = canonicalBytes(unsignedBody(ref), { domain: SIGNING_DOMAIN, schemaVersion: '1' });
    const signatureOk = options.signer
      ? await options.signer.verify(bytes, ref.signature)
      : await verifyWithKey(ref.signerPublicKeyHex, bytes, ref.signature);
    return Object.freeze({ ok: !!signatureOk, reason: signatureOk ? null : 'bad-signature' });
  } catch (error) {
    return Object.freeze({ ok: false, reason: 'invalid-schema', error });
  }
}
