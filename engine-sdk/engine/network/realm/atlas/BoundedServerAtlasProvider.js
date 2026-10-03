// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/** Optional opaque V3 Atlas provider matching the bounded ephemeral server contract. */

import { contentHashHex } from '../../../core/math/ChecksumMath.js';
import { byteSignature, hexToBytes } from '../../../core/math/FormatMath.js';
import { verifyWithKey } from '../../../state/authority/Identity.js';
import { canonicalize } from '../../../state/util/canonical.js';
import { realmKeyFingerprint } from '../addressing/RealmIds.js';
import {
  AtlasReplayGuard,
  canAccessAtlasRecordV1,
  verifyAtlasRecordV1,
} from './AtlasRecordV1.js';
import {
  ATLAS_PROVIDER_KIND,
  atlasProviderAllowsVisibility,
} from './AtlasProviders.js';

export const SERVER_ATLAS_ADVERTISEMENT_FORMAT = 'particle-atlas-advertisement/3';
export const SERVER_ATLAS_MAX_TTL_SECONDS = 300;
export const SERVER_ATLAS_MAX_PAYLOAD_BYTES = 16 * 1024;
export const SERVER_ATLAS_MAX_QUERY_RECORDS = 32;

const ENVELOPE_FIELDS = Object.freeze([
  'format', 'advertisementId', 'scopeTag', 'issuedAt', 'expiresAt', 'issuerKeyId',
  'issuerPublicKeyHex', 'ciphertextHex', 'signatureHex',
]);
const HEX_64_BYTES = /^[0-9a-f]{128}$/;
const HEX_32_BYTES = /^[0-9a-f]{64}$/;

export const BoundedAtlasTransportV1 = Object.freeze({
  name: 'BoundedAtlasTransportV1',
  version: 1,
  methods: Object.freeze(['publishAdvertisement', 'queryAdvertisements']),
  persistentRealmState: false,
  opaquePayloads: true,
});

function exactKeys(value, expected, name) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${name} must be an object`);
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (canonicalize(actual) !== canonicalize(wanted)) throw new TypeError(`${name} has unknown or missing fields`);
}

function bytes(value, name, expectedLength = null) {
  let result;
  if (typeof value === 'string' && /^[0-9a-f]+$/i.test(value) && value.length % 2 === 0) result = hexToBytes(value);
  else if (value instanceof Uint8Array) result = new Uint8Array(value);
  else if (ArrayBuffer.isView(value)) result = new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  else if (value instanceof ArrayBuffer) result = new Uint8Array(value);
  else throw new TypeError(`${name} must be bytes or hexadecimal bytes`);
  if (expectedLength !== null && result.byteLength !== expectedLength) {
    throw new TypeError(`${name} must contain exactly ${expectedLength} bytes`);
  }
  return result;
}

function lowercaseHex(value, name, bytesLength = null) {
  const text = String(value ?? '');
  if (!/^[0-9a-f]+$/.test(text) || text.length % 2 !== 0
    || (bytesLength !== null && text.length !== bytesLength * 2)) {
    throw new TypeError(`${name} must be lowercase hexadecimal bytes`);
  }
  return text;
}

function unsignedIdBody(record) {
  const value = { ...record };
  delete value.advertisementId;
  delete value.signatureHex;
  return value;
}

function signedBody(record) {
  const value = { ...record };
  delete value.signatureHex;
  return value;
}

function signatureHex(value) {
  let result = value;
  if (value instanceof ArrayBuffer || ArrayBuffer.isView(value)) {
    result = byteSignature(value instanceof ArrayBuffer ? new Uint8Array(value) : value);
  }
  result = String(result ?? '').toLowerCase();
  if (!HEX_64_BYTES.test(result)) throw new TypeError('server Atlas signature must be 64 bytes');
  return result;
}

function integer(value, name, minimum, maximum) {
  const result = Number(value);
  if (!Number.isSafeInteger(result) || result < minimum || result > maximum) {
    throw new TypeError(`${name} must be a safe integer from ${minimum} through ${maximum}`);
  }
  return result;
}

export async function deriveAtlasScopeTag(scopeKey) {
  return contentHashHex(bytes(scopeKey, 'Atlas scope key', 32), 'SHA-256');
}

async function importScopeKey(scopeKey, usage) {
  return crypto.subtle.importKey('raw', bytes(scopeKey, 'Atlas scope key', 32), { name: 'AES-GCM' }, false, [usage]);
}

async function sealAtlasRecord(record, scopeKey, scopeTag, randomValues) {
  const nonce = new Uint8Array(12);
  randomValues(nonce);
  const plaintext = new TextEncoder().encode(canonicalize(record));
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt({
    name: 'AES-GCM',
    iv: nonce,
    additionalData: new TextEncoder().encode(scopeTag),
    tagLength: 128,
  }, await importScopeKey(scopeKey, 'encrypt'), plaintext));
  const result = new Uint8Array(nonce.byteLength + ciphertext.byteLength);
  result.set(nonce, 0);
  result.set(ciphertext, nonce.byteLength);
  if (result.byteLength > SERVER_ATLAS_MAX_PAYLOAD_BYTES) {
    throw new RangeError(`sealed Atlas record exceeds ${SERVER_ATLAS_MAX_PAYLOAD_BYTES} bytes`);
  }
  return byteSignature(result);
}

async function openAtlasRecord(ciphertextHex, scopeKey, scopeTag) {
  const sealed = bytes(ciphertextHex, 'Atlas ciphertext');
  if (sealed.byteLength < 12 + 16 || sealed.byteLength > SERVER_ATLAS_MAX_PAYLOAD_BYTES) {
    throw new RangeError('Atlas ciphertext length is invalid');
  }
  const plaintext = await crypto.subtle.decrypt({
    name: 'AES-GCM',
    iv: sealed.subarray(0, 12),
    additionalData: new TextEncoder().encode(scopeTag),
    tagLength: 128,
  }, await importScopeKey(scopeKey, 'decrypt'), sealed.subarray(12));
  const source = new TextDecoder('utf-8', { fatal: true }).decode(plaintext);
  const record = JSON.parse(source);
  if (canonicalize(record) !== source) throw new TypeError('decrypted Atlas record is not canonical JSON');
  return record;
}

/** Build the exact opaque advertisement accepted by the additive V3 server. */
export async function createServerAtlasAdvertisement(record, {
  scopeKey,
  signer,
  issuedAt = Math.floor(Date.now() / 1000),
  ttlSeconds = 60,
  randomValues = value => crypto.getRandomValues(value),
} = {}) {
  if (!signer || signer.secure === false || typeof signer.sign !== 'function') throw new Error('a secure server Atlas signer is required');
  if (typeof randomValues !== 'function') throw new TypeError('Atlas nonce source must be a function');
  const nowSeconds = integer(issuedAt, 'Atlas advertisement issuedAt', 0, Number.MAX_SAFE_INTEGER);
  const lifetime = integer(ttlSeconds, 'Atlas advertisement ttlSeconds', 1, SERVER_ATLAS_MAX_TTL_SECONDS);
  const scopeTag = await deriveAtlasScopeTag(scopeKey);
  if (!record?.audience?.scopeTags?.includes(scopeTag)) {
    throw new Error('signed Atlas record does not authorize the selected server scope');
  }
  const recordVerification = await verifyAtlasRecordV1(record, { now: nowSeconds * 1000 });
  if (!recordVerification.valid) throw new Error(`Atlas record rejected before sealing: ${recordVerification.reason}`);
  const issuerPublicKeyHex = String(signer.publicKeyHex ?? '').toLowerCase();
  const issuerKeyId = await realmKeyFingerprint(issuerPublicKeyHex);
  if (signer.fingerprint && signer.fingerprint !== issuerKeyId) throw new Error('server Atlas signer fingerprint mismatch');
  const core = {
    format: SERVER_ATLAS_ADVERTISEMENT_FORMAT,
    scopeTag,
    issuedAt: nowSeconds,
    expiresAt: nowSeconds + lifetime,
    issuerKeyId,
    issuerPublicKeyHex,
    ciphertextHex: await sealAtlasRecord(record, scopeKey, scopeTag, randomValues),
  };
  const advertisementId = await contentHashHex(canonicalize(core), 'SHA-256');
  const signed = { ...core, advertisementId };
  return Object.freeze({
    ...signed,
    signatureHex: signatureHex(await signer.sign(canonicalize(signed))),
  });
}

export async function verifyServerAtlasAdvertisement(record, {
  now = Math.floor(Date.now() / 1000),
  expectedScopeTag = null,
  expectedIssuerKeyId = null,
} = {}) {
  try {
    exactKeys(record, ENVELOPE_FIELDS, 'server Atlas advertisement');
    if (record.format !== SERVER_ATLAS_ADVERTISEMENT_FORMAT) return Object.freeze({ valid: false, reason: 'format-invalid' });
    const scopeTag = lowercaseHex(record.scopeTag, 'scopeTag', 32);
    const publicKeyHex = lowercaseHex(record.issuerPublicKeyHex, 'issuerPublicKeyHex', 65);
    const issuerKeyId = lowercaseHex(record.issuerKeyId, 'issuerKeyId', 32);
    const advertisementId = lowercaseHex(record.advertisementId, 'advertisementId', 32);
    lowercaseHex(record.signatureHex, 'signatureHex', 64);
    const ciphertextHex = lowercaseHex(record.ciphertextHex, 'ciphertextHex');
    if (ciphertextHex.length / 2 < 28 || ciphertextHex.length / 2 > SERVER_ATLAS_MAX_PAYLOAD_BYTES) {
      return Object.freeze({ valid: false, reason: 'ciphertext-bounds' });
    }
    if (expectedScopeTag !== null && scopeTag !== expectedScopeTag) return Object.freeze({ valid: false, reason: 'scope-mismatch' });
    if (expectedIssuerKeyId !== null && issuerKeyId !== expectedIssuerKeyId) {
      return Object.freeze({ valid: false, reason: 'issuer-mismatch' });
    }
    if (await realmKeyFingerprint(publicKeyHex) !== issuerKeyId) return Object.freeze({ valid: false, reason: 'issuer-key-mismatch' });
    const issuedAt = integer(record.issuedAt, 'issuedAt', 0, Number.MAX_SAFE_INTEGER);
    const expiresAt = integer(record.expiresAt, 'expiresAt', 0, Number.MAX_SAFE_INTEGER);
    if (issuedAt > now + 30) return Object.freeze({ valid: false, reason: 'advertisement-from-future' });
    if (expiresAt <= now) return Object.freeze({ valid: false, reason: 'advertisement-expired' });
    if (expiresAt <= issuedAt || expiresAt - issuedAt > SERVER_ATLAS_MAX_TTL_SECONDS) {
      return Object.freeze({ valid: false, reason: 'advertisement-lifetime' });
    }
    const expectedId = await contentHashHex(canonicalize(unsignedIdBody(record)), 'SHA-256');
    if (advertisementId !== expectedId) return Object.freeze({ valid: false, reason: 'advertisement-id-mismatch' });
    if (!(await verifyWithKey(publicKeyHex, canonicalize(signedBody(record)), record.signatureHex))) {
      return Object.freeze({ valid: false, reason: 'advertisement-signature-invalid' });
    }
    return Object.freeze({ valid: true, advertisementId, scopeTag, issuerKeyId });
  } catch (error) {
    return Object.freeze({ valid: false, reason: error?.message ?? 'advertisement-malformed' });
  }
}

/** Verify and decrypt one V3 envelope without trusting the server that stored it. */
export async function openServerAtlasAdvertisement(advertisement, {
  scopeKey,
  now = Date.now(),
  authorizePublisher = null,
} = {}) {
  const scopeTag = await deriveAtlasScopeTag(scopeKey);
  const envelope = await verifyServerAtlasAdvertisement(advertisement, {
    now: Math.floor(now / 1000),
    expectedScopeTag: scopeTag,
  });
  if (!envelope.valid) return Object.freeze({ valid: false, reason: envelope.reason });
  try {
    const record = await openAtlasRecord(advertisement.ciphertextHex, scopeKey, scopeTag);
    if (!record?.audience?.scopeTags?.includes(scopeTag)) return Object.freeze({ valid: false, reason: 'record-scope-mismatch' });
    const verification = await verifyAtlasRecordV1(record, { now, authorizePublisher });
    if (!verification.valid) return Object.freeze({ valid: false, reason: verification.reason });
    return Object.freeze({ valid: true, advertisementId: advertisement.advertisementId, record });
  } catch (error) {
    return Object.freeze({ valid: false, reason: error?.message ?? 'advertisement-open-failed' });
  }
}

export class BoundedServerAtlasProvider {
  constructor({
    transport,
    signer,
    enabled = false,
    authorizePublisher = null,
    now = () => Date.now(),
    diagnostic = () => {},
    maximumQueryRecords = SERVER_ATLAS_MAX_QUERY_RECORDS,
  } = {}) {
    if (!transport || typeof transport.publishAdvertisement !== 'function'
      || typeof transport.queryAdvertisements !== 'function') {
      throw new TypeError('bounded server Atlas provider requires a conforming transport');
    }
    if (!signer || signer.secure === false || typeof signer.sign !== 'function') {
      throw new TypeError('bounded server Atlas provider requires a secure signer');
    }
    if (typeof now !== 'function' || typeof diagnostic !== 'function') throw new TypeError('invalid bounded server Atlas hooks');
    this.kind = ATLAS_PROVIDER_KIND.BOUNDED_SERVER;
    this.enabled = enabled === true;
    this._transport = transport;
    this._signer = signer;
    this._authorizePublisher = authorizePublisher;
    this._now = now;
    this._diagnostic = diagnostic;
    this._maximumQueryRecords = integer(maximumQueryRecords, 'maximumQueryRecords', 1, SERVER_ATLAS_MAX_QUERY_RECORDS);
    this._replay = new AtlasReplayGuard({ authorizePublisher, now });
    this._records = new Map();
  }

  _emit(event, fields = {}) {
    this._diagnostic(Object.freeze({
      component: 'realm-atlas', provider: this.kind, event, at: this._now(), ...fields,
    }));
  }

  setEnabled(enabled) {
    this.enabled = enabled === true;
    this._emit('provider-state', { enabled: this.enabled });
    return this.enabled;
  }

  async publish(record, { scopeKey, audienceContext = {}, ttlSeconds = 60 } = {}) {
    if (!this.enabled) return Object.freeze({ accepted: false, duplicate: false, reason: 'provider-disabled' });
    if (!atlasProviderAllowsVisibility(this.kind, record?.visibility)) {
      return Object.freeze({ accepted: false, duplicate: false, reason: 'visibility-not-routable' });
    }
    const verification = await verifyAtlasRecordV1(record, {
      now: this._now(),
      authorizePublisher: this._authorizePublisher,
    });
    if (!verification.valid) return Object.freeze({ accepted: false, duplicate: false, reason: verification.reason });
    const access = canAccessAtlasRecordV1(record, audienceContext);
    if (!access.allowed) return Object.freeze({ accepted: false, duplicate: false, reason: access.reason });
    const advertisement = await createServerAtlasAdvertisement(record, {
      scopeKey,
      signer: this._signer,
      issuedAt: Math.floor(this._now() / 1000),
      ttlSeconds,
    });
    const response = await this._transport.publishAdvertisement(advertisement);
    const duplicate = response?.duplicate === true;
    this._emit('advertisement-published', { advertisementId: advertisement.advertisementId, duplicate });
    return Object.freeze({
      accepted: response !== false && response?.accepted !== false,
      duplicate,
      reason: response === false || response?.accepted === false ? response?.reason ?? 'transport-rejected' : null,
      advertisementId: advertisement.advertisementId,
    });
  }

  async query({ scopeKey, audienceContext = {} } = {}) {
    if (!this.enabled) return Object.freeze([]);
    const scopeTag = await deriveAtlasScopeTag(scopeKey);
    const response = await this._transport.queryAdvertisements(scopeTag);
    const advertisements = Array.isArray(response) ? response : response?.records;
    if (!Array.isArray(advertisements)) throw new TypeError('bounded server Atlas query returned a non-array result');
    if (advertisements.length > this._maximumQueryRecords) {
      throw new RangeError('bounded server Atlas query exceeded the negotiated record limit');
    }
    const records = [];
    for (const advertisement of advertisements) {
      const opened = await openServerAtlasAdvertisement(advertisement, {
        scopeKey,
        now: this._now(),
        authorizePublisher: this._authorizePublisher,
      });
      if (!opened.valid) {
        this._emit('advertisement-rejected', {
          advertisementId: advertisement?.advertisementId ?? null,
          reason: opened.reason,
        });
        continue;
      }
      if (!atlasProviderAllowsVisibility(this.kind, opened.record.visibility)) {
        this._emit('advertisement-rejected', { advertisementId: opened.advertisementId, reason: 'visibility-not-routable' });
        continue;
      }
      const access = canAccessAtlasRecordV1(opened.record, {
        ...audienceContext,
        directLookup: true,
        scopeTags: [...new Set([...(audienceContext.scopeTags ?? []), scopeTag])],
      });
      if (!access.allowed) {
        this._emit('advertisement-rejected', { advertisementId: opened.advertisementId, reason: access.reason });
        continue;
      }
      const prior = this._replay.current(opened.record.realmId, opened.record.publisherId);
      const accepted = await this._replay.accept(opened.record);
      if (!accepted.accepted) {
        if (accepted.duplicate && this._records.has(opened.record.recordId)) records.push(this._records.get(opened.record.recordId));
        else this._emit('advertisement-rejected', { advertisementId: opened.advertisementId, reason: accepted.reason });
        continue;
      }
      if (prior) this._records.delete(prior.recordId);
      this._records.set(opened.record.recordId, opened.record);
      records.push(opened.record);
    }
    records.sort((a, b) => b.issuedAt - a.issuedAt || a.recordId.localeCompare(b.recordId));
    this._emit('query', { scopeTag, received: advertisements.length, accepted: records.length });
    return Object.freeze(records);
  }

  remove(recordId) {
    const removed = this._records.delete(recordId);
    if (removed) this._emit('local-cache-removed', { recordId });
    return removed;
  }

  prune(at = this._now()) {
    let removed = 0;
    for (const [recordId, record] of this._records) {
      if (record.expiresAt > at) continue;
      this._records.delete(recordId);
      removed += 1;
    }
    if (removed) this._emit('records-expired', { count: removed });
    return removed;
  }

  snapshot() {
    if (!this.enabled) return Object.freeze({ kind: this.kind, enabled: false, count: 0, records: Object.freeze([]) });
    this.prune();
    return Object.freeze({
      kind: this.kind,
      enabled: true,
      count: this._records.size,
      records: Object.freeze([...this._records.values()].sort((a, b) => a.recordId.localeCompare(b.recordId))),
    });
  }
}
