// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * Signed, fenced authority leases for semantic Realm state.
 *
 * Leases are explicit records. They never confer authority merely because a
 * peer has a connection, hosts a transport, or possesses a Capsule. Every
 * mutation must present the active lease ID and its monotonically increasing
 * fencing token.
 */

import { canonicalBytes, hashIdSecure } from '../../../state/util/canonical.js';
import { verifyWithKey } from '../../../state/authority/Identity.js';
import { byteSignature } from '../../../core/math/FormatMath.js';
import { assertRealmId, realmKeyFingerprint } from '../addressing/RealmIds.js';

export const AUTHORITY_LEASE_FORMAT = 'realm-authority-lease-v1';
export const AUTHORITY_REVOCATION_FORMAT = 'realm-authority-revocation-v1';

export const AUTHORITY_POLICY = Object.freeze({
  OWNER: 'owner',
  HOST: 'host',
  OBJECT: 'object',
  ZONE: 'zone',
  SHARED: 'shared',
  DETERMINISTIC: 'deterministic',
  DELEGATED: 'delegated',
  SERVER: 'server-authoritative',
});

const POLICIES = new Set(Object.values(AUTHORITY_POLICY));
const MAX_ACTIONS = 128;
const MAX_TEXT = 512;

function safeInteger(value, name, minimum = 0) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < minimum) throw new TypeError(`${name} must be an integer >= ${minimum}`);
  return number;
}

function boundedText(value, name, max = MAX_TEXT) {
  const text = String(value ?? '').trim();
  if (!text || text.length > max) throw new TypeError(`${name} must be a non-empty bounded string`);
  return text;
}

function normalizeActions(actions) {
  if (!Array.isArray(actions) || actions.length === 0 || actions.length > MAX_ACTIONS) {
    throw new TypeError('Authority lease actions must be a non-empty bounded array');
  }
  const normalized = [...new Set(actions.map(action => {
    const value = boundedText(action, 'authority action', 128);
    if (!/^[a-z][a-z0-9._:-]*$/.test(value)) throw new TypeError('Authority action has an invalid form');
    return value;
  }))].sort();
  if (normalized.length !== actions.length) throw new TypeError('Authority lease actions must be unique');
  return Object.freeze(normalized);
}

function normalizeFallback(value) {
  if (value == null) return null;
  const policy = boundedText(value.policy, 'fallback policy');
  if (!POLICIES.has(policy)) throw new TypeError('Unsupported fallback authority policy');
  return Object.freeze({
    policy,
    holderId: value.holderId == null ? null : assertRealmId(value.holderId, null, 'fallback holder ID'),
    delayMs: safeInteger(value.delayMs ?? 0, 'fallback delayMs'),
  });
}

function signatureHex(signature) {
  if (typeof signature === 'string' && /^[0-9a-f]+$/i.test(signature)) return signature.toLowerCase();
  if (signature instanceof ArrayBuffer || ArrayBuffer.isView(signature)) {
    return byteSignature(signature instanceof ArrayBuffer ? new Uint8Array(signature) : signature);
  }
  throw new TypeError('Authority signer returned an invalid signature');
}

function unsigned(record, idField) {
  const value = { ...record };
  delete value[idField];
  delete value.signatureHex;
  return value;
}

function signingBytes(record, idField, format) {
  return canonicalBytes(unsigned(record, idField), {
    domain: 'realm-network.authority.signature',
    schemaVersion: format,
  });
}

async function recordId(record, idField, format) {
  return hashIdSecure(unsigned(record, idField), {
    domain: 'realm-network.authority',
    schemaVersion: format,
  });
}

async function signerDescriptor(signer) {
  if (!signer || signer.secure === false || typeof signer.sign !== 'function') throw new Error('A secure authority signer is required');
  const publicKeyHex = String(signer.publicKeyHex ?? '').toLowerCase();
  const fingerprint = await realmKeyFingerprint(publicKeyHex);
  if (signer.fingerprint && signer.fingerprint !== fingerprint) throw new Error('Authority signer fingerprint does not match its public key');
  return Object.freeze({ publicKeyHex, fingerprint });
}

async function finishSigned(record, idField, signer) {
  const signerInfo = await signerDescriptor(signer);
  const withSigner = { ...record, signer: signerInfo };
  const id = await recordId(withSigner, idField, record.format);
  const signature = signatureHex(await signer.sign(signingBytes(withSigner, idField, record.format)));
  return Object.freeze({ ...withSigner, [idField]: id, signatureHex: signature });
}

async function verifySigned(record, idField, format) {
  if (!record || record.format !== format || !record.signer) return { valid: false, reason: 'malformed-record' };
  try {
    const fingerprint = await realmKeyFingerprint(record.signer.publicKeyHex);
    if (fingerprint !== record.signer.fingerprint) return { valid: false, reason: 'signer-fingerprint-mismatch' };
    const expected = await recordId(record, idField, format);
    if (record[idField] !== expected) return { valid: false, reason: 'record-id-mismatch' };
    if (!(await verifyWithKey(record.signer.publicKeyHex, signingBytes(record, idField, format), record.signatureHex))) {
      return { valid: false, reason: 'signature-invalid' };
    }
    return { valid: true, recordId: expected, signerFingerprint: fingerprint };
  } catch (error) {
    return { valid: false, reason: error?.message ?? 'verification-failed' };
  }
}

function normalizeLease(input) {
  const policy = boundedText(input.policy, 'authority policy');
  if (!POLICIES.has(policy)) throw new TypeError('Unsupported authority policy');
  const issuedAt = safeInteger(input.issuedAt ?? Date.now(), 'issuedAt');
  const notBefore = safeInteger(input.notBefore ?? issuedAt, 'notBefore');
  const expiresAt = safeInteger(input.expiresAt, 'expiresAt');
  if (notBefore < issuedAt || expiresAt <= notBefore) throw new RangeError('Authority lease time window is invalid');
  return {
    format: AUTHORITY_LEASE_FORMAT,
    realmId: assertRealmId(input.realmId, 'realm', 'Realm ID'),
    branchId: assertRealmId(input.branchId, 'branch', 'Branch ID'),
    resourceId: assertRealmId(input.resourceId, null, 'authority resource ID'),
    policy,
    holderId: assertRealmId(input.holderId, null, 'authority holder ID'),
    issuerId: assertRealmId(input.issuerId, null, 'authority issuer ID'),
    actions: normalizeActions(input.actions),
    fencingToken: safeInteger(input.fencingToken, 'fencingToken', 1),
    issuedAt,
    notBefore,
    expiresAt,
    renewalOf: input.renewalOf == null ? null : boundedText(input.renewalOf, 'renewalOf', 96),
    delegationGrantId: input.delegationGrantId == null ? null : boundedText(input.delegationGrantId, 'delegationGrantId', 128),
    fallback: normalizeFallback(input.fallback),
  };
}

export async function createAuthorityLease(input, signer) {
  return finishSigned(normalizeLease(input), 'leaseId', signer);
}

export async function renewAuthorityLease(previous, input, signer) {
  const checked = await verifyAuthorityLease(previous, { allowExpired: true, allowFuture: true });
  if (!checked.valid) throw new Error(`Cannot renew invalid authority lease: ${checked.reason}`);
  const next = normalizeLease({
    ...previous,
    ...input,
    realmId: previous.realmId,
    branchId: previous.branchId,
    resourceId: previous.resourceId,
    policy: input?.policy ?? previous.policy,
    holderId: input?.holderId ?? previous.holderId,
    issuerId: input?.issuerId ?? previous.issuerId,
    actions: input?.actions ?? previous.actions,
    fencingToken: input?.fencingToken ?? previous.fencingToken + 1,
    renewalOf: previous.leaseId,
    issuedAt: input?.issuedAt ?? Date.now(),
    notBefore: input?.notBefore ?? input?.issuedAt ?? Date.now(),
  });
  if (next.fencingToken <= previous.fencingToken) throw new RangeError('Renewal fencing token must increase');
  return finishSigned(next, 'leaseId', signer);
}

export async function verifyAuthorityLease(lease, options = {}) {
  const verified = await verifySigned(lease, 'leaseId', AUTHORITY_LEASE_FORMAT);
  if (!verified.valid) return verified;
  try {
    const normalized = normalizeLease(lease);
    const now = safeInteger(options.now ?? Date.now(), 'verification time');
    const skew = safeInteger(options.maxClockSkewMs ?? 0, 'maxClockSkewMs');
    if (!options.allowFuture && now + skew < normalized.notBefore) return { valid: false, reason: 'lease-not-yet-valid' };
    if (!options.allowExpired && now - skew >= normalized.expiresAt) return { valid: false, reason: 'lease-expired' };
    if (typeof options.authorizeIssuer === 'function'
      && !(await options.authorizeIssuer(lease.issuerId, lease.signer.fingerprint, lease))) {
      return { valid: false, reason: 'issuer-unauthorized' };
    }
    return { ...verified, lease: normalized };
  } catch (error) {
    return { valid: false, reason: error?.message ?? 'lease-invalid' };
  }
}

export async function createAuthorityRevocation(input, signer) {
  const record = {
    format: AUTHORITY_REVOCATION_FORMAT,
    realmId: assertRealmId(input.realmId, 'realm', 'Realm ID'),
    branchId: assertRealmId(input.branchId, 'branch', 'Branch ID'),
    resourceId: assertRealmId(input.resourceId, null, 'authority resource ID'),
    leaseId: boundedText(input.leaseId, 'leaseId', 96),
    issuerId: assertRealmId(input.issuerId, null, 'authority issuer ID'),
    fencingToken: safeInteger(input.fencingToken, 'fencingToken', 1),
    revokedAt: safeInteger(input.revokedAt ?? Date.now(), 'revokedAt'),
    reason: boundedText(input.reason ?? 'authority-revoked', 'revocation reason', 1024),
  };
  return finishSigned(record, 'revocationId', signer);
}

export async function verifyAuthorityRevocation(record, options = {}) {
  const verified = await verifySigned(record, 'revocationId', AUTHORITY_REVOCATION_FORMAT);
  if (!verified.valid) return verified;
  try {
    assertRealmId(record.realmId, 'realm');
    assertRealmId(record.branchId, 'branch');
    assertRealmId(record.resourceId);
    assertRealmId(record.issuerId);
    boundedText(record.leaseId, 'leaseId', 96);
    safeInteger(record.fencingToken, 'fencingToken', 1);
    safeInteger(record.revokedAt, 'revokedAt');
    boundedText(record.reason, 'reason', 1024);
    if (typeof options.authorizeIssuer === 'function'
      && !(await options.authorizeIssuer(record.issuerId, record.signer.fingerprint, record))) {
      return { valid: false, reason: 'issuer-unauthorized' };
    }
    return verified;
  } catch (error) {
    return { valid: false, reason: error?.message ?? 'revocation-invalid' };
  }
}
