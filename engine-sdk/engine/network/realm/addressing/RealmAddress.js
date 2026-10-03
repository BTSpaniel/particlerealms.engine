// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/** RealmAddress.js — human aliases that resolve to location-independent IDs. */

import { canonicalBytes, hashIdSecure } from '../../../state/util/canonical.js';
import { verifyWithKey } from '../../../state/authority/Identity.js';
import { byteSignature } from '../../../core/math/FormatMath.js';
import {
  REALM_ID_TYPE,
  assertRealmId,
  isRealmId,
  realmKeyFingerprint,
} from './RealmIds.js';

export const REALM_ALIAS_FORMAT = 'realm-alias-record-v1';

const MAX_ADDRESS_BYTES = 1024;
const MAX_SEGMENTS = 16;
const MAX_SEGMENT_LENGTH = 128;
const encoder = new TextEncoder();

function cleanSegment(value) {
  const decoded = decodeURIComponent(String(value ?? '')).normalize('NFKC').trim().toLowerCase();
  if (!decoded || decoded.length > MAX_SEGMENT_LENGTH || decoded === '.' || decoded === '..') {
    throw new TypeError('realm address contains an invalid segment');
  }
  if (!/^[\p{L}\p{N}](?:[\p{L}\p{N}._~-]*[\p{L}\p{N}])?$/u.test(decoded)) {
    throw new TypeError('realm address segment contains unsupported characters');
  }
  return decoded;
}

/** Parse and canonicalize a realm:// alias or direct-ID address. */
export function parseRealmAddress(address) {
  const text = String(address ?? '').trim();
  if (!text || encoder.encode(text).byteLength > MAX_ADDRESS_BYTES) throw new TypeError('realm address is empty or too long');
  let url;
  try { url = new URL(text); } catch (_) { throw new TypeError('realm address is malformed'); }
  if (url.protocol !== 'realm:' || url.username || url.password || url.port || url.search || url.hash) {
    throw new TypeError('realm address must use realm:// with no credentials, port, query, or fragment');
  }
  const rawSegments = [url.hostname, ...url.pathname.split('/').filter(Boolean)];
  if (rawSegments.length < 1 || rawSegments.length > MAX_SEGMENTS) throw new TypeError('realm address has an invalid segment count');
  if (url.hostname.toLowerCase() === 'id') {
    if (rawSegments.length !== 2) throw new TypeError('direct Realm address must contain exactly one ID');
    const realmId = decodeURIComponent(rawSegments[1]);
    assertRealmId(realmId, REALM_ID_TYPE.REALM, 'direct Realm ID');
    return Object.freeze({ kind: 'id', realmId, canonical: realmAddressForId(realmId), segments: Object.freeze(['id', realmId]) });
  }
  const segments = rawSegments.map(cleanSegment);
  const canonical = `realm://${segments.map(encodeURIComponent).join('/')}`;
  return Object.freeze({ kind: 'alias', alias: canonical, canonical, segments: Object.freeze(segments) });
}

export function realmAddressForId(realmId) {
  assertRealmId(realmId, REALM_ID_TYPE.REALM, 'Realm ID');
  return `realm://id/${encodeURIComponent(realmId)}`;
}

function signatureHex(value) {
  if (typeof value === 'string' && /^[0-9a-f]+$/i.test(value)) return value.toLowerCase();
  if (value instanceof Uint8Array || ArrayBuffer.isView(value) || value instanceof ArrayBuffer) {
    return byteSignature(value instanceof ArrayBuffer ? new Uint8Array(value) : value);
  }
  throw new Error('alias signer returned an invalid signature');
}

function unsignedRecord(record) {
  const copy = { ...record };
  delete copy.recordId;
  delete copy.signatureHex;
  return copy;
}

function aliasPayload(record) {
  return canonicalBytes(unsignedRecord(record), {
    domain: 'realm-network.address.signature',
    schemaVersion: REALM_ALIAS_FORMAT,
  });
}

async function aliasRecordId(record) {
  return hashIdSecure(unsignedRecord(record), {
    domain: 'realm-network.address',
    schemaVersion: REALM_ALIAS_FORMAT,
  });
}

/** Create an attributable alias update. Aliases can move; Realm IDs cannot. */
export async function createRealmAliasRecord(input, signer) {
  if (!signer || signer.secure === false || typeof signer.sign !== 'function') throw new Error('a secure alias signer is required');
  const parsed = parseRealmAddress(input?.address);
  if (parsed.kind !== 'alias') throw new TypeError('an alias record cannot target a direct-ID address');
  assertRealmId(input.realmId, REALM_ID_TYPE.REALM, 'Realm ID');
  if (input.branchId !== null && input.branchId !== undefined) assertRealmId(input.branchId, REALM_ID_TYPE.BRANCH, 'Branch ID');
  if (!isRealmId(input.issuerId, REALM_ID_TYPE.USER) && !isRealmId(input.issuerId, REALM_ID_TYPE.ORGANIZATION)) {
    throw new TypeError('alias issuer must be a user or organization ID');
  }
  const publicKeyHex = String(signer.publicKeyHex ?? '').toLowerCase();
  const fingerprint = await realmKeyFingerprint(publicKeyHex);
  if (fingerprint !== signer.fingerprint) throw new Error('alias signer fingerprint does not match its key');
  const issuedAt = Number(input.issuedAt ?? Date.now());
  const expiresAt = input.expiresAt === null || input.expiresAt === undefined ? null : Number(input.expiresAt);
  const sequence = Number(input.sequence ?? 0);
  if (!Number.isSafeInteger(issuedAt) || issuedAt < 0 || !Number.isSafeInteger(sequence) || sequence < 0) {
    throw new TypeError('alias record time or sequence is invalid');
  }
  if (expiresAt !== null && (!Number.isSafeInteger(expiresAt) || expiresAt <= issuedAt)) {
    throw new TypeError('alias expiration must follow issuance');
  }
  const record = {
    format: REALM_ALIAS_FORMAT,
    address: parsed.canonical,
    realmId: input.realmId,
    branchId: input.branchId ?? null,
    issuerId: input.issuerId,
    sequence,
    previousRecordId: input.previousRecordId ?? null,
    issuedAt,
    expiresAt,
    issuer: Object.freeze({ fingerprint, publicKeyHex }),
  };
  const recordId = await aliasRecordId(record);
  const signature = signatureHex(await signer.sign(aliasPayload(record)));
  return Object.freeze({ ...record, recordId, signatureHex: signature });
}

export async function verifyRealmAliasRecord(record, options = {}) {
  try {
    if (!record || record.format !== REALM_ALIAS_FORMAT) return { valid: false, reason: 'malformed-alias-record' };
    const parsed = parseRealmAddress(record.address);
    if (parsed.kind !== 'alias' || parsed.canonical !== record.address) return { valid: false, reason: 'noncanonical-alias' };
    assertRealmId(record.realmId, REALM_ID_TYPE.REALM);
    if (record.branchId !== null) assertRealmId(record.branchId, REALM_ID_TYPE.BRANCH);
    if (!isRealmId(record.issuerId, REALM_ID_TYPE.USER) && !isRealmId(record.issuerId, REALM_ID_TYPE.ORGANIZATION)) {
      return { valid: false, reason: 'invalid-alias-issuer' };
    }
    if (!Number.isSafeInteger(record.sequence) || record.sequence < 0 || !Number.isSafeInteger(record.issuedAt) || record.issuedAt < 0) {
      return { valid: false, reason: 'invalid-alias-clock' };
    }
    if ((record.sequence === 0) !== (record.previousRecordId === null)) return { valid: false, reason: 'invalid-alias-link' };
    const fingerprint = await realmKeyFingerprint(record.issuer.publicKeyHex);
    if (fingerprint !== record.issuer.fingerprint) return { valid: false, reason: 'alias-fingerprint-mismatch' };
    if (await aliasRecordId(record) !== record.recordId) return { valid: false, reason: 'alias-record-id-mismatch' };
    if (!(await verifyWithKey(record.issuer.publicKeyHex, aliasPayload(record), record.signatureHex))) {
      return { valid: false, reason: 'alias-signature-invalid' };
    }
    if (typeof options.authorizeIssuer === 'function'
      && !(await options.authorizeIssuer(record.issuerId, record.issuer.fingerprint, record.realmId))) {
      return { valid: false, reason: 'alias-issuer-unauthorized' };
    }
    if (record.expiresAt !== null && Number(options.now ?? Date.now()) >= record.expiresAt) {
      return { valid: false, reason: 'alias-record-expired' };
    }
    return { valid: true, recordId: record.recordId, realmId: record.realmId, branchId: record.branchId };
  } catch (error) {
    return { valid: false, reason: error?.message || 'alias-verification-failed' };
  }
}

/** In-memory verified resolver. Persistence/discovery providers can replay records into it. */
export class RealmAddressResolver {
  constructor(options = {}) {
    this._records = new Map();
    this._authorizeIssuer = options.authorizeIssuer ?? null;
    this._now = options.now ?? (() => Date.now());
  }

  async register(record) {
    const verification = await verifyRealmAliasRecord(record, {
      authorizeIssuer: this._authorizeIssuer,
      now: this._now(),
    });
    if (!verification.valid) throw new Error(`alias record rejected: ${verification.reason}`);
    const current = this._records.get(record.address) ?? null;
    if (!current) {
      if (record.sequence !== 0 || record.previousRecordId !== null) throw new Error('alias history is missing its predecessor');
    } else if (record.sequence !== current.sequence + 1 || record.previousRecordId !== current.recordId
      || record.issuedAt < current.issuedAt) {
      throw new Error('alias update does not extend the current record');
    }
    this._records.set(record.address, record);
    return Object.freeze({ realmId: record.realmId, branchId: record.branchId, recordId: record.recordId });
  }

  resolve(address) {
    const parsed = parseRealmAddress(address);
    if (parsed.kind === 'id') {
      return Object.freeze({ realmId: parsed.realmId, branchId: null, source: 'direct', address: parsed.canonical });
    }
    const record = this._records.get(parsed.canonical);
    if (!record || (record.expiresAt !== null && this._now() >= record.expiresAt)) return null;
    return Object.freeze({
      realmId: record.realmId,
      branchId: record.branchId,
      source: 'alias',
      address: parsed.canonical,
      recordId: record.recordId,
      issuerId: record.issuerId,
    });
  }

  remove(address, expectedRecordId = null) {
    const parsed = parseRealmAddress(address);
    if (parsed.kind !== 'alias') return false;
    const current = this._records.get(parsed.canonical);
    if (!current || (expectedRecordId !== null && current.recordId !== expectedRecordId)) return false;
    return this._records.delete(parsed.canonical);
  }

  list() {
    return [...this._records.values()].sort((a, b) => a.address.localeCompare(b.address));
  }
}

