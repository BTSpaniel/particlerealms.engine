// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/** Shared signed-record plumbing for Realm branch contracts. */

import { byteSignature } from '../../../core/math/FormatMath.js';
import { verifyWithKey } from '../../../state/authority/Identity.js';
import { canonicalBytes, hashIdSecure } from '../../../state/util/canonical.js';
import { realmKeyFingerprint } from '../addressing/RealmIds.js';
import { deepFreeze } from '../capsule/RealmCapsuleSchema.js';

function signatureHex(value) {
  if (typeof value === 'string' && /^[0-9a-f]+$/i.test(value)) return value.toLowerCase();
  if (value instanceof ArrayBuffer || ArrayBuffer.isView(value)) {
    return byteSignature(value instanceof ArrayBuffer
      ? new Uint8Array(value)
      : new Uint8Array(value.buffer, value.byteOffset, value.byteLength));
  }
  throw new TypeError('Realm branch signer returned an invalid signature');
}

export function withoutSignedFields(record, idField) {
  const unsigned = { ...record };
  delete unsigned[idField];
  delete unsigned.signatureHex;
  return unsigned;
}

function signingBytes(record, idField, format) {
  return canonicalBytes(withoutSignedFields(record, idField), {
    domain: 'realm-network.branches.signature',
    schemaVersion: format,
  });
}

async function recordId(record, idField, format) {
  return hashIdSecure(withoutSignedFields(record, idField), {
    domain: 'realm-network.branches.record',
    schemaVersion: format,
  });
}

async function signerInfo(signer) {
  if (!signer || signer.secure !== true || typeof signer.sign !== 'function') {
    throw new Error('Realm branch records require a secure signer');
  }
  const publicKeyHex = String(signer.publicKeyHex ?? '').toLowerCase();
  const fingerprint = await realmKeyFingerprint(publicKeyHex);
  if (signer.fingerprint && signer.fingerprint !== fingerprint) {
    throw new Error('Realm branch signer fingerprint does not match its public key');
  }
  return Object.freeze({ fingerprint, publicKeyHex });
}

export async function signBranchRecord(body, { idField, format }, signer) {
  const withSigner = { ...body, signer: await signerInfo(signer) };
  const id = await recordId(withSigner, idField, format);
  const signature = signatureHex(await signer.sign(signingBytes(withSigner, idField, format)));
  return deepFreeze({ ...withSigner, [idField]: id, signatureHex: signature });
}

export async function verifyBranchRecord(record, { idField, format }) {
  try {
    if (!record || record.format !== format || !record.signer) {
      return Object.freeze({ valid: false, reason: 'malformed-record' });
    }
    const fingerprint = await realmKeyFingerprint(record.signer.publicKeyHex);
    if (fingerprint !== record.signer.fingerprint) {
      return Object.freeze({ valid: false, reason: 'signer-fingerprint-mismatch' });
    }
    const expectedId = await recordId(record, idField, format);
    if (record[idField] !== expectedId) {
      return Object.freeze({ valid: false, reason: 'record-id-mismatch' });
    }
    if (!(await verifyWithKey(
      record.signer.publicKeyHex,
      signingBytes(record, idField, format),
      record.signatureHex,
    ))) {
      return Object.freeze({ valid: false, reason: 'signature-invalid' });
    }
    return Object.freeze({
      valid: true,
      recordId: expectedId,
      signerFingerprint: fingerprint,
    });
  } catch (error) {
    return Object.freeze({ valid: false, reason: error?.message ?? 'verification-failed' });
  }
}
