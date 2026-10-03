// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/** Shared signing primitives for Realm organization and capability records. */

import { byteSignature } from '../../../core/math/FormatMath.js';
import { verifyWithKey } from '../../../state/authority/Identity.js';
import { canonicalBytes, hashIdSecure } from '../../../state/util/canonical.js';
import { realmKeyFingerprint } from '../addressing/RealmIds.js';

function signatureHex(signature) {
  if (typeof signature === 'string' && /^[0-9a-f]+$/i.test(signature)) return signature.toLowerCase();
  if (signature instanceof ArrayBuffer || ArrayBuffer.isView(signature)) {
    return byteSignature(signature instanceof ArrayBuffer ? new Uint8Array(signature) : signature);
  }
  throw new TypeError('Realm governance signer returned an invalid signature');
}

function unsigned(record, idField) {
  const value = { ...record };
  delete value[idField];
  delete value.signatureHex;
  return value;
}

function signingBytes(record, idField, format) {
  return canonicalBytes(unsigned(record, idField), {
    domain: 'realm-network.governance.signature',
    schemaVersion: format,
  });
}

async function computeRecordId(record, idField, format) {
  return hashIdSecure(unsigned(record, idField), {
    domain: 'realm-network.governance.record',
    schemaVersion: format,
  });
}

export async function signerDescriptor(signer) {
  if (!signer || signer.secure === false || typeof signer.sign !== 'function') {
    throw new Error('A secure Realm governance signer is required');
  }
  const publicKeyHex = String(signer.publicKeyHex ?? '').toLowerCase();
  const fingerprint = await realmKeyFingerprint(publicKeyHex);
  if (signer.fingerprint && signer.fingerprint !== fingerprint) {
    throw new Error('Realm governance signer fingerprint does not match its public key');
  }
  return Object.freeze({ publicKeyHex, fingerprint });
}

export async function finishSignedRecord(record, idField, signer) {
  const descriptor = await signerDescriptor(signer);
  const withSigner = { ...record, signer: descriptor };
  const recordId = await computeRecordId(withSigner, idField, record.format);
  const signature = signatureHex(await signer.sign(signingBytes(withSigner, idField, record.format)));
  return Object.freeze({ ...withSigner, [idField]: recordId, signatureHex: signature });
}

export async function verifySignedRecord(record, { format, idField }) {
  if (!record || record.format !== format || !record.signer) {
    return { valid: false, reason: 'malformed-record' };
  }
  try {
    const fingerprint = await realmKeyFingerprint(record.signer.publicKeyHex);
    if (fingerprint !== record.signer.fingerprint) {
      return { valid: false, reason: 'signer-fingerprint-mismatch' };
    }
    const expectedId = await computeRecordId(record, idField, format);
    if (record[idField] !== expectedId) return { valid: false, reason: 'record-id-mismatch' };
    if (!(await verifyWithKey(record.signer.publicKeyHex, signingBytes(record, idField, format), record.signatureHex))) {
      return { valid: false, reason: 'signature-invalid' };
    }
    return { valid: true, recordId: expectedId, signerFingerprint: fingerprint };
  } catch (error) {
    return { valid: false, reason: error?.message ?? 'record-verification-failed' };
  }
}

export function boundedInteger(value, name, minimum = 0) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < minimum) {
    throw new TypeError(`${name} must be an integer >= ${minimum}`);
  }
  return number;
}

export function boundedToken(value, name, maximum = 128, { wildcard = false } = {}) {
  const text = String(value ?? '').trim().toLowerCase();
  if (wildcard && text === '*') return text;
  if (!text || text.length > maximum || !/^[a-z][a-z0-9._:-]*$/.test(text)) {
    throw new TypeError(`${name} must be a bounded lowercase token`);
  }
  return text;
}

export function boundedText(value, name, maximum = 512) {
  const text = String(value ?? '').trim();
  if (!text || text.length > maximum) throw new TypeError(`${name} must be non-empty and at most ${maximum} characters`);
  return text;
}

export function uniqueSorted(values, name, normalize, maximum = 128) {
  if (!Array.isArray(values) || values.length === 0 || values.length > maximum) {
    throw new TypeError(`${name} must be a non-empty array with at most ${maximum} entries`);
  }
  const normalized = values.map((value, index) => normalize(value, `${name}[${index}]`));
  if (new Set(normalized).size !== normalized.length) throw new TypeError(`${name} must not contain duplicates`);
  return Object.freeze(normalized.sort());
}
