// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/** Shared validation and domain-separated signing for the Navi Accord wire protocol. */

import { byteSignature } from '../../../core/math/FormatMath.js';
import { verifyWithKey } from '../../../state/authority/Identity.js';
import { canonicalBytes, canonicalize, hashIdSecure } from '../../../state/util/canonical.js';
import { REALM_ID_TYPE, assertRealmId, isRealmId, realmKeyFingerprint } from '../addressing/RealmIds.js';

export const ACCORD_MAX_LIFETIME_MS = 24 * 60 * 60 * 1000;
export const ACCORD_MAX_PUBLIC_BYTES = 256 * 1024;

const FORBIDDEN_PUBLIC_KEYS = new Set([
  'accesstoken', 'apikey', 'authorization', 'authtoken', 'browsercookies', 'browsersession',
  'chathistory', 'cookie', 'cookies', 'credential', 'credentials', 'mnemonic',
  'memory', 'memories', 'memoryexport', 'memorysnapshot', 'password', 'passwd',
  'privatekey', 'privatememory', 'recoverycode', 'refreshtoken', 'secret',
  'secrets', 'seed', 'sessiondump', 'sessionexport', 'sessiontoken',
]);

const BUDGET_FIELDS = Object.freeze([
  'computeMs',
  'inputBytes',
  'networkBytes',
  'outputBytes',
  'workUnits',
]);

function normalizedKey(value) {
  return String(value).toLowerCase().replace(/[^a-z0-9]/g, '');
}

export function safeInteger(value, name, minimum = 0, maximum = Number.MAX_SAFE_INTEGER) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < minimum || number > maximum) {
    throw new TypeError(`${name} must be an integer from ${minimum} through ${maximum}`);
  }
  return number;
}

export function boundedText(value, name, maximum = 512) {
  const text = String(value ?? '').trim();
  if (!text || text.length > maximum) throw new TypeError(`${name} must be non-empty and at most ${maximum} characters`);
  return text;
}

export function boundedToken(value, name, maximum = 128) {
  const text = String(value ?? '').trim().toLowerCase();
  if (!text || text.length > maximum || !/^[a-z][a-z0-9._:-]*$/.test(text)) {
    throw new TypeError(`${name} must be a bounded lowercase token`);
  }
  return text;
}

export function normalizeNonce(value, name = 'nonce') {
  const nonce = String(value ?? '').trim().toLowerCase();
  if (nonce.length < 16 || nonce.length > 128 || !/^[a-z0-9_-]+$/.test(nonce)) {
    throw new TypeError(`${name} must contain 16 to 128 lowercase URL-safe characters`);
  }
  return nonce;
}

export function assertSecureRecordId(value, name = 'record ID') {
  const id = String(value ?? '').trim().toLowerCase();
  if (!/^sha256:256:[0-9a-f]{64}$/.test(id)) throw new TypeError(`${name} must be a SHA-256 record ID`);
  return id;
}

export function normalizeTokenList(values, name, { maximum = 128, allowEmpty = false } = {}) {
  if (!Array.isArray(values) || (!allowEmpty && values.length === 0) || values.length > maximum) {
    throw new TypeError(`${name} must be ${allowEmpty ? 'a' : 'a non-empty'} bounded array`);
  }
  const normalized = values.map((value, index) => boundedToken(value, `${name}[${index}]`));
  if (new Set(normalized).size !== normalized.length) throw new TypeError(`${name} must not contain duplicates`);
  return Object.freeze(normalized.sort());
}

export function normalizeIdList(values, name, { maximum = 128, allowEmpty = true } = {}) {
  if (!Array.isArray(values) || (!allowEmpty && values.length === 0) || values.length > maximum) {
    throw new TypeError(`${name} must be ${allowEmpty ? 'a' : 'a non-empty'} bounded array`);
  }
  const normalized = values.map((value, index) => assertRealmId(value, null, `${name}[${index}]`));
  if (new Set(normalized).size !== normalized.length) throw new TypeError(`${name} must not contain duplicates`);
  return Object.freeze(normalized.sort());
}

export function assertIdentityId(value, name = 'identity ID') {
  const types = [
    REALM_ID_TYPE.USER,
    REALM_ID_TYPE.NAVI,
    REALM_ID_TYPE.AGENT,
    REALM_ID_TYPE.ORGANIZATION,
    REALM_ID_TYPE.DEVICE,
  ];
  if (!types.some(type => isRealmId(value, type))) {
    throw new TypeError(`${name} must be a user, Navi, agent, organization, or device Realm ID`);
  }
  return value;
}

export function normalizeWindow(input, { issuedAt = Date.now(), maximumLifetimeMs = ACCORD_MAX_LIFETIME_MS } = {}) {
  const issued = safeInteger(input.issuedAt ?? issuedAt, 'issuedAt');
  const notBefore = safeInteger(input.notBefore ?? issued, 'notBefore');
  const expiresAt = safeInteger(input.expiresAt, 'expiresAt');
  if (notBefore < issued || expiresAt <= notBefore) throw new RangeError('Accord validity window is invalid');
  if (expiresAt - issued > maximumLifetimeMs) throw new RangeError('Accord validity window exceeds the maximum lifetime');
  return Object.freeze({ issuedAt: issued, notBefore, expiresAt });
}

export function validateActiveWindow(record, now = Date.now(), { allowExpired = false } = {}) {
  const at = safeInteger(now, 'verification time');
  if (at < record.notBefore) return Object.freeze({ valid: false, reason: 'not-yet-valid' });
  if (!allowExpired && at >= record.expiresAt) return Object.freeze({ valid: false, reason: 'expired' });
  return Object.freeze({ valid: true });
}

export function normalizeBudget(value, name = 'budget', { allowZero = false } = {}) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${name} must be an object`);
  const unknown = Object.keys(value).filter(key => !BUDGET_FIELDS.includes(key));
  if (unknown.length) throw new TypeError(`${name} contains unsupported fields: ${unknown.sort().join(', ')}`);
  const budget = {};
  for (const field of BUDGET_FIELDS) {
    budget[field] = safeInteger(value[field] ?? 0, `${name}.${field}`, 0, 2 ** 40);
  }
  if (!allowZero && !BUDGET_FIELDS.some(field => budget[field] > 0)) throw new RangeError(`${name} must grant at least one bounded resource`);
  return Object.freeze(budget);
}

export function budgetWithin(candidate, ceiling) {
  const normalized = normalizeBudget(candidate, 'candidate budget', { allowZero: true });
  const maximum = normalizeBudget(ceiling, 'budget ceiling', { allowZero: true });
  return BUDGET_FIELDS.every(field => normalized[field] <= maximum[field]);
}

export function normalizeScope(value, name = 'scope') {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${name} must be an object`);
  const allowed = new Set(['actions', 'domain', 'resourceIds']);
  const unknown = Object.keys(value).filter(key => !allowed.has(key));
  if (unknown.length) throw new TypeError(`${name} contains unsupported fields: ${unknown.sort().join(', ')}`);
  return Object.freeze({
    domain: boundedToken(value.domain, `${name}.domain`, 96),
    actions: normalizeTokenList(value.actions, `${name}.actions`, { maximum: 64 }),
    resourceIds: normalizeIdList(value.resourceIds ?? [], `${name}.resourceIds`, { maximum: 128 }),
  });
}

export function scopeWithin(candidate, ceiling) {
  const inner = normalizeScope(candidate, 'candidate scope');
  const outer = normalizeScope(ceiling, 'scope ceiling');
  if (inner.domain !== outer.domain) return false;
  if (inner.actions.some(action => !outer.actions.includes(action))) return false;
  return inner.resourceIds.every(resourceId => outer.resourceIds.includes(resourceId));
}

/**
 * Validate bounded JSON-compatible public data and reject common exfiltration
 * containers. This is deliberately structural: unrestricted session exports,
 * credentials, and private-memory payloads cannot be smuggled under aliases.
 */
export function assertSafePublicData(value, name = 'public data', { maximumBytes = ACCORD_MAX_PUBLIC_BYTES } = {}) {
  let nodes = 0;
  const seen = new Set();
  const visit = (item, path, depth) => {
    nodes += 1;
    if (nodes > 4096) throw new TypeError(`${name} exceeds the node limit`);
    if (depth > 12) throw new TypeError(`${name} exceeds the depth limit`);
    if (item === null || typeof item === 'string' || typeof item === 'boolean') return;
    if (typeof item === 'number') {
      if (!Number.isFinite(item)) throw new TypeError(`${path} contains a non-finite number`);
      return;
    }
    if (!item || typeof item !== 'object') throw new TypeError(`${path} contains a non-JSON value`);
    if (seen.has(item)) throw new TypeError(`${path} contains a cycle`);
    seen.add(item);
    if (Array.isArray(item)) {
      if (item.length > 256) throw new TypeError(`${path} exceeds the list limit`);
      item.forEach((entry, index) => visit(entry, `${path}[${index}]`, depth + 1));
    } else {
      const prototype = Object.getPrototypeOf(item);
      if (prototype !== Object.prototype && prototype !== null) throw new TypeError(`${path} must be a plain object`);
      const entries = Object.entries(item);
      if (entries.length > 128) throw new TypeError(`${path} exceeds the field limit`);
      for (const [key, entry] of entries) {
        const normalized = normalizedKey(key);
        if (FORBIDDEN_PUBLIC_KEYS.has(normalized)
          || normalized.includes('credential')
          || normalized.includes('privatekey')
          || normalized.endsWith('password')
          || normalized.endsWith('secret')
          || normalized.endsWith('token')
          || normalized.includes('privatememory')
          || normalized.includes('sessionexport')
          || normalized.includes('unrestrictedsession')) {
          throw new TypeError(`${path}.${key} is prohibited from Accord public data`);
        }
        visit(entry, `${path}.${key}`, depth + 1);
      }
    }
    seen.delete(item);
  };
  visit(value, name, 0);
  const bytes = new TextEncoder().encode(canonicalize(value)).byteLength;
  if (bytes > maximumBytes) throw new RangeError(`${name} exceeds ${maximumBytes} canonical bytes`);
  return value;
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const entry of Object.values(value)) deepFreeze(entry);
  return Object.freeze(value);
}

export function canonicalPublicCopy(value, name = 'public data', options = {}) {
  assertSafePublicData(value, name, options);
  return deepFreeze(JSON.parse(canonicalize(value)));
}

function signatureHex(signature) {
  if (typeof signature === 'string' && /^[0-9a-f]+$/i.test(signature)) return signature.toLowerCase();
  if (signature instanceof ArrayBuffer || ArrayBuffer.isView(signature)) {
    return byteSignature(signature instanceof ArrayBuffer ? new Uint8Array(signature) : signature);
  }
  throw new TypeError('Accord signer returned an invalid signature');
}

function unsigned(record, idField) {
  const value = { ...record };
  delete value[idField];
  delete value.signatureHex;
  return value;
}

function signingBytes(record, idField) {
  return canonicalBytes(unsigned(record, idField), {
    domain: 'realm-network.accord.signature',
    schemaVersion: record.format,
  });
}

async function recordId(record, idField) {
  return hashIdSecure(unsigned(record, idField), {
    domain: 'realm-network.accord.record',
    schemaVersion: record.format,
  });
}

export async function accordSignerDescriptor(signer) {
  if (!signer || signer.secure === false || typeof signer.sign !== 'function') throw new Error('A secure Accord signer is required');
  const publicKeyHex = String(signer.publicKeyHex ?? '').toLowerCase();
  const fingerprint = await realmKeyFingerprint(publicKeyHex);
  if (signer.fingerprint && signer.fingerprint !== fingerprint) throw new Error('Accord signer fingerprint does not match its public key');
  return Object.freeze({ publicKeyHex, fingerprint });
}

export async function finishSignedAccordRecord(record, idField, signer) {
  const signerInfo = await accordSignerDescriptor(signer);
  const withSigner = { ...record, signer: signerInfo };
  const id = await recordId(withSigner, idField);
  const signature = signatureHex(await signer.sign(signingBytes(withSigner, idField)));
  return Object.freeze({ ...withSigner, [idField]: id, signatureHex: signature });
}

export async function verifySignedAccordRecord(record, { format, idField }) {
  if (!record || record.format !== format || !record.signer) return Object.freeze({ valid: false, reason: 'malformed-record' });
  try {
    const fingerprint = await realmKeyFingerprint(record.signer.publicKeyHex);
    if (record.signer.fingerprint !== fingerprint) return Object.freeze({ valid: false, reason: 'signer-fingerprint-mismatch' });
    const expectedId = await recordId(record, idField);
    if (record[idField] !== expectedId) return Object.freeze({ valid: false, reason: 'record-id-mismatch' });
    if (!(await verifyWithKey(record.signer.publicKeyHex, signingBytes(record, idField), record.signatureHex))) {
      return Object.freeze({ valid: false, reason: 'signature-invalid' });
    }
    return Object.freeze({ valid: true, recordId: expectedId, signerFingerprint: fingerprint });
  } catch (error) {
    return Object.freeze({ valid: false, reason: error?.message ?? 'record-verification-failed' });
  }
}

export async function authorizeWith(adapter, record, role) {
  if (adapter == null) return Object.freeze({ valid: true });
  if (typeof adapter !== 'function') return Object.freeze({ valid: false, reason: `${role}-authorizer-invalid` });
  try {
    const result = await adapter(record, record.signer);
    const allowed = result === true || result?.valid === true || result?.allowed === true;
    return allowed
      ? Object.freeze({ valid: true })
      : Object.freeze({ valid: false, reason: result?.reason ?? `${role}-unauthorized` });
  } catch (error) {
    return Object.freeze({ valid: false, reason: error?.message ?? `${role}-authorization-failed` });
  }
}

export function exactKeys(value, expected, name) {
  const actual = Object.keys(value ?? {}).sort();
  const wanted = [...expected].sort();
  if (canonicalize(actual) !== canonicalize(wanted)) throw new TypeError(`${name} has unknown or missing fields`);
}

export function normalizedBodyMatches(record, normalized) {
  const projected = {};
  for (const key of Object.keys(normalized)) projected[key] = record[key];
  return canonicalize(projected) === canonicalize(normalized);
}
