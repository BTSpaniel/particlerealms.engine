// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * RealmPassport.js — portable, signed public identity records.
 *
 * This module owns no keys and performs no persistence.  It consumes the
 * existing signer interface and produces canonical records that can be stored,
 * copied, and independently verified by any Realm Network peer.
 */

import { canonicalBytes } from '../../../state/util/canonical.js';
import { hashIdSecure } from '../../../state/util/canonical.js';
import { verifyWithKey } from '../../../state/authority/Identity.js';
import { byteSignature } from '../../../core/math/FormatMath.js';
import {
  REALM_ID_TYPE,
  assertRealmId,
  createKeyControlledRealmId,
  isRealmId,
  realmKeyFingerprint,
} from '../addressing/RealmIds.js';

export const PASSPORT_FORMAT = 'realm-passport-v1';
export const PASSPORT_LINEAGE_FORMAT = 'realm-passport-lineage-v1';
export const PASSPORT_EVENT_FORMAT = 'realm-passport-event-v1';
export const DEVICE_GRANT_FORMAT = 'realm-device-grant-v1';
export const DEVICE_REVOCATION_FORMAT = 'realm-device-revocation-v1';
export const RECOVERY_POLICY_FORMAT = 'realm-recovery-policy-v1';
export const RECOVERY_RECORD_FORMAT = 'realm-recovery-record-v1';

const MAX_HISTORY = 256;
const MAX_LIST = 128;
const MAX_LABEL = 256;
const MAX_REASON = 1024;
const MAX_DELAY_MS = 365 * 24 * 60 * 60 * 1000;
const PRIVATE_FIELD = /^(?:private|privatekey|workingpriv|recovery|recoverycode|credential|credentials|secret|secrets|token|tokens|memory|memories|context)$/i;

function cleanText(value, label, max = MAX_LABEL, allowEmpty = false) {
  const text = String(value ?? '').trim();
  if ((!allowEmpty && !text) || text.length > max) throw new TypeError(`${label} is invalid`);
  return text;
}

function finiteTime(value, label = 'timestamp') {
  const time = Number(value);
  if (!Number.isSafeInteger(time) || time < 0) throw new TypeError(`${label} must be a non-negative integer`);
  return time;
}

function assertPublicValue(value, path = 'passport', depth = 0, seen = new Set()) {
  if (depth > 12) throw new TypeError(`${path} exceeds the public Passport depth limit`);
  if (value === null || ['string', 'number', 'boolean'].includes(typeof value)) return;
  if (typeof value !== 'object') throw new TypeError(`${path} contains a non-public value`);
  if (seen.has(value)) throw new TypeError(`${path} contains a cycle`);
  seen.add(value);
  if (Array.isArray(value)) {
    if (value.length > MAX_LIST) throw new TypeError(`${path} exceeds the public Passport list limit`);
    value.forEach((item, index) => assertPublicValue(item, `${path}[${index}]`, depth + 1, seen));
  } else {
    for (const [key, item] of Object.entries(value)) {
      if (PRIVATE_FIELD.test(key)) throw new TypeError(`${path}.${key} is not permitted in a public Passport`);
      assertPublicValue(item, `${path}.${key}`, depth + 1, seen);
    }
  }
  seen.delete(value);
}

function signatureHex(signature) {
  if (typeof signature === 'string' && /^[0-9a-f]+$/i.test(signature)) return signature.toLowerCase();
  if (signature instanceof Uint8Array || ArrayBuffer.isView(signature) || signature instanceof ArrayBuffer) {
    return byteSignature(signature instanceof ArrayBuffer ? new Uint8Array(signature) : signature);
  }
  throw new Error('signer returned an invalid signature');
}

function signerView(signer) {
  if (!signer || signer.secure === false || typeof signer.sign !== 'function') {
    throw new Error('a secure signer is required');
  }
  const publicKeyHex = cleanText(signer.publicKeyHex, 'signer public key');
  if (!/^[0-9a-f]{130}$/i.test(publicKeyHex)) throw new TypeError('signer public key must be raw P-256 hex');
  const fingerprint = cleanText(signer.fingerprint, 'signer fingerprint');
  if (!/^[0-9a-f]{64}$/.test(fingerprint)) throw new TypeError('signer fingerprint must be full SHA-256 hex');
  return { publicKeyHex: publicKeyHex.toLowerCase(), fingerprint };
}

function unsigned(record, idField) {
  const out = { ...record };
  delete out[idField];
  delete out.signatureHex;
  delete out.signatures;
  return out;
}

async function recordId(record, idField, schemaVersion) {
  return hashIdSecure(unsigned(record, idField), {
    domain: 'realm-network.passport',
    schemaVersion,
  });
}

function signingPayload(record, idField, schemaVersion) {
  return canonicalBytes(unsigned(record, idField), {
    domain: 'realm-network.passport.signature',
    schemaVersion,
  });
}

async function signRecord(record, idField, schemaVersion, signer) {
  const issuer = signerView(signer);
  const withIssuer = { ...record, issuer };
  const id = await recordId(withIssuer, idField, schemaVersion);
  const signature = signatureHex(await signer.sign(signingPayload(withIssuer, idField, schemaVersion)));
  return Object.freeze({ ...withIssuer, [idField]: id, signatureHex: signature });
}

async function verifySignedRecord(record, idField, schemaVersion, format) {
  if (!record || record.format !== format || !record.issuer) return { valid: false, reason: 'malformed-record' };
  try {
    const fingerprint = await realmKeyFingerprint(record.issuer.publicKeyHex);
    if (fingerprint !== record.issuer.fingerprint) return { valid: false, reason: 'issuer-fingerprint-mismatch' };
    const expectedId = await recordId(record, idField, schemaVersion);
    if (record[idField] !== expectedId) return { valid: false, reason: 'record-id-mismatch' };
    const verified = await verifyWithKey(
      record.issuer.publicKeyHex,
      signingPayload(record, idField, schemaVersion),
      record.signatureHex,
    );
    return verified
      ? { valid: true, fingerprint, recordId: expectedId }
      : { valid: false, reason: 'signature-invalid' };
  } catch (error) {
    return { valid: false, reason: error?.message || 'verification-failed' };
  }
}

function keyNode(signer, at) {
  const view = signerView(signer);
  return Object.freeze({ ...view, activatedAt: finiteTime(at, 'key activation time') });
}

function eventPayload(event) {
  const out = { ...event };
  delete out.eventId;
  delete out.signatures;
  return out;
}

async function eventId(event) {
  return hashIdSecure(eventPayload(event), {
    domain: 'realm-network.passport-lineage',
    schemaVersion: PASSPORT_EVENT_FORMAT,
  });
}

function eventSigningPayload(event) {
  return canonicalBytes(eventPayload(event), {
    domain: 'realm-network.passport-lineage.signature',
    schemaVersion: PASSPORT_EVENT_FORMAT,
  });
}

async function eventSignature(role, signer, event) {
  const view = signerView(signer);
  return Object.freeze({
    role,
    ...view,
    signatureHex: signatureHex(await signer.sign(eventSigningPayload(event))),
  });
}

/** Create a self-signed genesis lineage. The Passport ID is bound to its root key. */
export async function createPassportLineage({ passportId, createdAt = Date.now() }, rootSigner) {
  const root = keyNode(rootSigner, createdAt);
  assertRealmId(passportId, REALM_ID_TYPE.USER, 'Passport ID');
  const derived = await createKeyControlledRealmId(REALM_ID_TYPE.USER, root.publicKeyHex);
  if (derived !== passportId) throw new Error('Passport ID does not match its genesis key');
  const event = {
    format: PASSPORT_EVENT_FORMAT,
    passportId,
    sequence: 0,
    type: 'genesis',
    previousEventId: null,
    previousKey: null,
    nextKey: root,
    occurredAt: finiteTime(createdAt),
    reason: 'identity-created',
    recovery: null,
  };
  const id = await eventId(event);
  const signatures = [await eventSignature('self', rootSigner, event)];
  return Object.freeze({
    format: PASSPORT_LINEAGE_FORMAT,
    passportId,
    rootFingerprint: root.fingerprint,
    events: [Object.freeze({ ...event, eventId: id, signatures })],
  });
}

async function appendKeyChange(lineage, newSigner, previousSigner, options, type) {
  const checked = await verifyPassportLineage(lineage);
  if (!checked.valid) throw new Error(`cannot extend invalid Passport lineage: ${checked.reason}`);
  if (checked.revoked) throw new Error('cannot rotate a revoked Passport without an external recovery authorization');
  const occurredAt = finiteTime(options?.occurredAt ?? Date.now());
  const previousKey = checked.headKey;
  const previousView = signerView(previousSigner);
  if (previousView.fingerprint !== previousKey.fingerprint || previousView.publicKeyHex !== previousKey.publicKeyHex) {
    throw new Error('previous signer is not the current Passport key');
  }
  const nextKey = keyNode(newSigner, occurredAt);
  if (nextKey.fingerprint === previousKey.fingerprint) throw new Error('new Passport key equals current key');
  const last = lineage.events[lineage.events.length - 1];
  const event = {
    format: PASSPORT_EVENT_FORMAT,
    passportId: lineage.passportId,
    sequence: lineage.events.length,
    type,
    previousEventId: last.eventId,
    previousKey,
    nextKey,
    occurredAt,
    reason: cleanText(options?.reason ?? (type === 'recovery' ? 'identity-recovered' : 'identity-rotated'), 'reason', MAX_REASON),
    recovery: type === 'recovery' ? Object.freeze({
      method: cleanText(options?.recovery?.method ?? 'recovery-key', 'recovery method'),
      policyId: options?.recovery?.policyId ?? null,
      evidenceIds: Object.freeze([...(options?.recovery?.evidenceIds ?? [])].map((id) => cleanText(id, 'recovery evidence ID'))),
    }) : null,
  };
  const id = await eventId(event);
  const signatures = [
    await eventSignature('previous', previousSigner, event),
    await eventSignature('successor', newSigner, event),
  ];
  return Object.freeze({
    ...lineage,
    events: Object.freeze([...lineage.events, Object.freeze({ ...event, eventId: id, signatures })]),
  });
}

export function appendPassportRotation(lineage, newSigner, previousSigner, options = {}) {
  return appendKeyChange(lineage, newSigner, previousSigner, options, 'rotation');
}

export function appendPassportRecovery(lineage, newSigner, previousSigner, options = {}) {
  return appendKeyChange(lineage, newSigner, previousSigner, options, 'recovery');
}

/** Append a terminal, signed key-revocation record. */
export async function appendPassportRevocation(lineage, currentSigner, options = {}) {
  const checked = await verifyPassportLineage(lineage);
  if (!checked.valid) throw new Error(`cannot revoke invalid Passport lineage: ${checked.reason}`);
  if (checked.revoked) throw new Error('Passport is already revoked');
  const current = signerView(currentSigner);
  if (current.fingerprint !== checked.headKey.fingerprint || current.publicKeyHex !== checked.headKey.publicKeyHex) {
    throw new Error('revocation signer is not the current Passport key');
  }
  const occurredAt = finiteTime(options.occurredAt ?? Date.now());
  const last = lineage.events[lineage.events.length - 1];
  const event = {
    format: PASSPORT_EVENT_FORMAT,
    passportId: lineage.passportId,
    sequence: lineage.events.length,
    type: 'revocation',
    previousEventId: last.eventId,
    previousKey: checked.headKey,
    nextKey: null,
    occurredAt,
    reason: cleanText(options.reason ?? 'identity-revoked', 'reason', MAX_REASON),
    recovery: null,
  };
  const id = await eventId(event);
  const signatures = [await eventSignature('current', currentSigner, event)];
  return Object.freeze({
    ...lineage,
    events: Object.freeze([...lineage.events, Object.freeze({ ...event, eventId: id, signatures })]),
  });
}

/** Verify every digest, key fingerprint, link, and signature in a lineage. */
export async function verifyPassportLineage(lineage) {
  if (!lineage || lineage.format !== PASSPORT_LINEAGE_FORMAT || !Array.isArray(lineage.events)) {
    return { valid: false, reason: 'malformed-lineage' };
  }
  if (!isRealmId(lineage.passportId, REALM_ID_TYPE.USER)) return { valid: false, reason: 'invalid-passport-id' };
  if (lineage.events.length < 1 || lineage.events.length > MAX_HISTORY) return { valid: false, reason: 'invalid-history-length' };
  let headKey = null;
  let previousEventId = null;
  let previousTime = -1;
  let revoked = false;
  for (let index = 0; index < lineage.events.length; index++) {
    const event = lineage.events[index];
    if (!event || event.format !== PASSPORT_EVENT_FORMAT || event.passportId !== lineage.passportId
      || event.sequence !== index || event.previousEventId !== previousEventId) {
      return { valid: false, reason: `event-${index}-link-invalid` };
    }
    if (await eventId(event) !== event.eventId) return { valid: false, reason: `event-${index}-id-invalid` };
    if (!Number.isSafeInteger(event.occurredAt) || event.occurredAt < previousTime
      || (event.nextKey !== null && event.nextKey?.activatedAt !== event.occurredAt)) {
      return { valid: false, reason: `event-${index}-time-invalid` };
    }
    try { cleanText(event.reason, 'reason', MAX_REASON); }
    catch (_) { return { valid: false, reason: `event-${index}-reason-invalid` }; }
    const signatures = Array.isArray(event.signatures) ? event.signatures : [];
    const expectedRoles = index === 0 ? ['self']
      : event.type === 'revocation' ? ['current']
        : ['previous', 'successor'];
    if (signatures.length !== expectedRoles.length) return { valid: false, reason: `event-${index}-signature-count` };
    for (let sigIndex = 0; sigIndex < signatures.length; sigIndex++) {
      const signature = signatures[sigIndex];
      if (signature.role !== expectedRoles[sigIndex]) return { valid: false, reason: `event-${index}-signature-role` };
      try {
        const fingerprint = await realmKeyFingerprint(signature.publicKeyHex);
        if (fingerprint !== signature.fingerprint) return { valid: false, reason: `event-${index}-fingerprint` };
        const ok = await verifyWithKey(signature.publicKeyHex, eventSigningPayload(event), signature.signatureHex);
        if (!ok) return { valid: false, reason: `event-${index}-signature-invalid` };
      } catch (_) {
        return { valid: false, reason: `event-${index}-signature-malformed` };
      }
    }
    if (index === 0) {
      if (event.type !== 'genesis' || event.previousKey !== null || !event.nextKey || event.recovery !== null) {
        return { valid: false, reason: 'genesis-invalid' };
      }
      const derived = await createKeyControlledRealmId(REALM_ID_TYPE.USER, event.nextKey.publicKeyHex);
      if (derived !== lineage.passportId || event.nextKey.fingerprint !== signatures[0].fingerprint
        || event.nextKey.publicKeyHex !== signatures[0].publicKeyHex
        || lineage.rootFingerprint !== event.nextKey.fingerprint) {
        return { valid: false, reason: 'genesis-key-invalid' };
      }
      headKey = event.nextKey;
    } else if (event.type === 'rotation' || event.type === 'recovery') {
      if (revoked || !event.previousKey || !event.nextKey
        || event.previousKey.fingerprint !== headKey.fingerprint
        || event.previousKey.publicKeyHex !== headKey.publicKeyHex
        || signatures[0].fingerprint !== headKey.fingerprint
        || signatures[1].fingerprint !== event.nextKey.fingerprint
        || signatures[1].publicKeyHex !== event.nextKey.publicKeyHex) {
        return { valid: false, reason: `event-${index}-key-transition-invalid` };
      }
      if (event.type === 'rotation' && event.recovery !== null) return { valid: false, reason: `event-${index}-unexpected-recovery` };
      if (event.type === 'recovery') {
        try {
          cleanText(event.recovery?.method, 'recovery method');
          if (event.recovery.policyId !== null) cleanText(event.recovery.policyId, 'recovery policy ID');
          if (!Array.isArray(event.recovery.evidenceIds) || event.recovery.evidenceIds.length > MAX_LIST) throw new TypeError('invalid evidence');
          event.recovery.evidenceIds.forEach((id) => cleanText(id, 'recovery evidence ID'));
        } catch (_) {
          return { valid: false, reason: `event-${index}-recovery-invalid` };
        }
      }
      headKey = event.nextKey;
    } else if (event.type === 'revocation') {
      if (revoked || !event.previousKey || event.nextKey !== null
        || event.previousKey.fingerprint !== headKey.fingerprint
        || signatures[0].fingerprint !== headKey.fingerprint) {
        return { valid: false, reason: `event-${index}-revocation-invalid` };
      }
      if (event.recovery !== null) return { valid: false, reason: `event-${index}-unexpected-recovery` };
      revoked = true;
    } else {
      return { valid: false, reason: `event-${index}-type-invalid` };
    }
    previousEventId = event.eventId;
    previousTime = event.occurredAt;
  }
  return { valid: true, passportId: lineage.passportId, headKey, revoked, headEventId: previousEventId };
}

function normalizeScopes(scopes) {
  if (!Array.isArray(scopes) || scopes.length < 1 || scopes.length > MAX_LIST) throw new TypeError('scopes must be a non-empty bounded list');
  return Object.freeze([...new Set(scopes.map((scope) => cleanText(scope, 'scope', 128)))].sort());
}

export async function createDeviceGrant(input, passportSigner) {
  const issuedAt = finiteTime(input?.issuedAt ?? Date.now(), 'issuedAt');
  assertRealmId(input?.passportId, REALM_ID_TYPE.USER, 'Passport ID');
  assertRealmId(input?.deviceId, REALM_ID_TYPE.DEVICE, 'Device ID');
  const deviceFingerprint = await realmKeyFingerprint(input.devicePublicKeyHex);
  const derivedDeviceId = await createKeyControlledRealmId(REALM_ID_TYPE.DEVICE, input.devicePublicKeyHex);
  if (derivedDeviceId !== input.deviceId) throw new Error('Device ID does not match its key');
  const expiresAt = input.expiresAt === null || input.expiresAt === undefined ? null : finiteTime(input.expiresAt, 'expiresAt');
  if (expiresAt !== null && expiresAt <= issuedAt) throw new TypeError('device grant must expire after it is issued');
  return signRecord({
    format: DEVICE_GRANT_FORMAT,
    passportId: input.passportId,
    deviceId: input.deviceId,
    devicePublicKeyHex: String(input.devicePublicKeyHex).toLowerCase(),
    deviceFingerprint,
    label: cleanText(input.label ?? 'Authorized device', 'device label'),
    scopes: normalizeScopes(input.scopes ?? ['realm.connect']),
    issuedAt,
    expiresAt,
  }, 'grantId', DEVICE_GRANT_FORMAT, passportSigner);
}

export async function verifyDeviceGrant(grant, options = {}) {
  const result = await verifySignedRecord(grant, 'grantId', DEVICE_GRANT_FORMAT, DEVICE_GRANT_FORMAT);
  if (!result.valid) return result;
  try {
    assertRealmId(grant.passportId, REALM_ID_TYPE.USER);
    assertRealmId(grant.deviceId, REALM_ID_TYPE.DEVICE);
    if (await realmKeyFingerprint(grant.devicePublicKeyHex) !== grant.deviceFingerprint) return { valid: false, reason: 'device-fingerprint-mismatch' };
    if (await createKeyControlledRealmId(REALM_ID_TYPE.DEVICE, grant.devicePublicKeyHex) !== grant.deviceId) return { valid: false, reason: 'device-id-mismatch' };
    cleanText(grant.label, 'device label');
    const scopes = normalizeScopes(grant.scopes);
    if (scopes.length !== grant.scopes.length || scopes.some((scope, index) => scope !== grant.scopes[index])) {
      return { valid: false, reason: 'device-scopes-noncanonical' };
    }
    finiteTime(grant.issuedAt, 'issuedAt');
    if (grant.expiresAt !== null && (!Number.isSafeInteger(grant.expiresAt) || grant.expiresAt <= grant.issuedAt)) {
      return { valid: false, reason: 'device-expiration-invalid' };
    }
    if (grant.expiresAt !== null && Number(options.now ?? Date.now()) >= grant.expiresAt) return { valid: false, reason: 'device-grant-expired' };
    if (options.lineage) {
      const lineage = await verifyPassportLineage(options.lineage);
      const known = options.lineage.events.some((event) => event.nextKey?.fingerprint === grant.issuer.fingerprint);
      if (!lineage.valid || lineage.passportId !== grant.passportId || !known) return { valid: false, reason: 'grant-issuer-not-in-lineage' };
    }
    return { ...result, passportId: grant.passportId, deviceId: grant.deviceId };
  } catch (error) {
    return { valid: false, reason: error?.message || 'device-grant-invalid' };
  }
}

export async function createDeviceRevocation(input, passportSigner) {
  assertRealmId(input?.passportId, REALM_ID_TYPE.USER, 'Passport ID');
  assertRealmId(input?.deviceId, REALM_ID_TYPE.DEVICE, 'Device ID');
  return signRecord({
    format: DEVICE_REVOCATION_FORMAT,
    passportId: input.passportId,
    deviceId: input.deviceId,
    grantId: cleanText(input.grantId, 'device grant ID'),
    revokedAt: finiteTime(input.revokedAt ?? Date.now(), 'revokedAt'),
    reason: cleanText(input.reason ?? 'device-revoked', 'reason', MAX_REASON),
  }, 'revocationId', DEVICE_REVOCATION_FORMAT, passportSigner);
}

export async function verifyDeviceRevocation(record, options = {}) {
  const result = await verifySignedRecord(record, 'revocationId', DEVICE_REVOCATION_FORMAT, DEVICE_REVOCATION_FORMAT);
  if (!result.valid) return result;
  if (!isRealmId(record.passportId, REALM_ID_TYPE.USER) || !isRealmId(record.deviceId, REALM_ID_TYPE.DEVICE)) {
    return { valid: false, reason: 'revocation-identity-invalid' };
  }
  try {
    cleanText(record.grantId, 'device grant ID');
    cleanText(record.reason, 'reason', MAX_REASON);
    finiteTime(record.revokedAt, 'revokedAt');
  } catch (error) {
    return { valid: false, reason: error.message };
  }
  if (options.grant && (options.grant.grantId !== record.grantId || options.grant.deviceId !== record.deviceId)) {
    return { valid: false, reason: 'revocation-grant-mismatch' };
  }
  return { ...result, passportId: record.passportId, deviceId: record.deviceId };
}

function identityList(values, type, label) {
  if (!Array.isArray(values) || values.length > MAX_LIST) throw new TypeError(`${label} must be a bounded list`);
  const unique = [...new Set(values.map((id) => assertRealmId(id, type, label)))];
  return Object.freeze(unique.sort());
}

function threshold(value, available, label) {
  const number = Number(value ?? (available ? 1 : 0));
  if (!Number.isSafeInteger(number) || number < 0 || number > available || (available > 0 && number < 1)) {
    throw new TypeError(`${label} threshold is invalid`);
  }
  return number;
}

export async function createRecoveryPolicy(input, passportSigner) {
  assertRealmId(input?.passportId, REALM_ID_TYPE.USER, 'Passport ID');
  const trustedDevices = identityList(input.trustedDevices ?? [], REALM_ID_TYPE.DEVICE, 'trusted devices');
  const trustedContacts = identityList(input.trustedContacts ?? [], REALM_ID_TYPE.USER, 'trusted contacts');
  const organizations = identityList(input.organizations ?? [], REALM_ID_TYPE.ORGANIZATION, 'recovery organizations');
  const highRiskDelayMs = Number(input.highRiskDelayMs ?? 0);
  if (!Number.isSafeInteger(highRiskDelayMs) || highRiskDelayMs < 0 || highRiskDelayMs > MAX_DELAY_MS) {
    throw new TypeError('high-risk recovery delay is invalid');
  }
  const previousPolicyId = input.previousPolicyId ?? null;
  if (previousPolicyId !== null) cleanText(previousPolicyId, 'previous policy ID');
  return signRecord({
    format: RECOVERY_POLICY_FORMAT,
    passportId: input.passportId,
    version: Number.isSafeInteger(input.version) && input.version > 0 ? input.version : 1,
    previousPolicyId,
    recoveryKeyAllowed: input.recoveryKeyAllowed !== false,
    trustedDevices,
    trustedDeviceThreshold: threshold(input.trustedDeviceThreshold, trustedDevices.length, 'trusted device'),
    trustedContacts,
    trustedContactThreshold: threshold(input.trustedContactThreshold, trustedContacts.length, 'trusted contact'),
    organizations,
    organizationThreshold: threshold(input.organizationThreshold, organizations.length, 'organization'),
    highRiskDelayMs,
    issuedAt: finiteTime(input.issuedAt ?? Date.now(), 'issuedAt'),
  }, 'policyId', RECOVERY_POLICY_FORMAT, passportSigner);
}

export async function verifyRecoveryPolicy(policy) {
  const result = await verifySignedRecord(policy, 'policyId', RECOVERY_POLICY_FORMAT, RECOVERY_POLICY_FORMAT);
  if (!result.valid) return result;
  try {
    assertRealmId(policy.passportId, REALM_ID_TYPE.USER);
    const devices = identityList(policy.trustedDevices, REALM_ID_TYPE.DEVICE, 'trusted devices');
    const contacts = identityList(policy.trustedContacts, REALM_ID_TYPE.USER, 'trusted contacts');
    const organizations = identityList(policy.organizations, REALM_ID_TYPE.ORGANIZATION, 'recovery organizations');
    if (devices.some((id, index) => id !== policy.trustedDevices[index])
      || contacts.some((id, index) => id !== policy.trustedContacts[index])
      || organizations.some((id, index) => id !== policy.organizations[index])) {
      return { valid: false, reason: 'recovery-principals-noncanonical' };
    }
    threshold(policy.trustedDeviceThreshold, devices.length, 'trusted device');
    threshold(policy.trustedContactThreshold, contacts.length, 'trusted contact');
    threshold(policy.organizationThreshold, organizations.length, 'organization');
    if (!Number.isSafeInteger(policy.highRiskDelayMs) || policy.highRiskDelayMs < 0 || policy.highRiskDelayMs > MAX_DELAY_MS) {
      return { valid: false, reason: 'recovery-delay-invalid' };
    }
    if (!Number.isSafeInteger(policy.version) || policy.version < 1 || !Number.isSafeInteger(policy.issuedAt) || policy.issuedAt < 0) {
      return { valid: false, reason: 'recovery-policy-version-invalid' };
    }
    if ((policy.version === 1) !== (policy.previousPolicyId === null)) {
      return { valid: false, reason: 'recovery-policy-link-invalid' };
    }
    return { ...result, passportId: policy.passportId };
  } catch (error) {
    return { valid: false, reason: error?.message || 'recovery-policy-invalid' };
  }
}

export async function createRecoveryRecord(input, passportSigner) {
  assertRealmId(input?.passportId, REALM_ID_TYPE.USER, 'Passport ID');
  const evidenceIds = Object.freeze([...new Set([...(input.evidenceIds ?? [])]
    .map((id) => cleanText(id, 'evidence ID')))].sort());
  if (evidenceIds.length > MAX_LIST) throw new TypeError('too many recovery evidence records');
  return signRecord({
    format: RECOVERY_RECORD_FORMAT,
    passportId: input.passportId,
    policyId: input.policyId ?? null,
    method: cleanText(input.method ?? 'recovery-key', 'recovery method'),
    evidenceIds,
    requestedAt: finiteTime(input.requestedAt ?? Date.now(), 'requestedAt'),
    completedAt: finiteTime(input.completedAt ?? Date.now(), 'completedAt'),
    resultingLineageEventId: input.resultingLineageEventId ?? null,
  }, 'recoveryId', RECOVERY_RECORD_FORMAT, passportSigner);
}

export async function verifyRecoveryRecord(record, options = {}) {
  const result = await verifySignedRecord(record, 'recoveryId', RECOVERY_RECORD_FORMAT, RECOVERY_RECORD_FORMAT);
  if (!result.valid) return result;
  if (!isRealmId(record.passportId, REALM_ID_TYPE.USER)) return { valid: false, reason: 'recovery-passport-invalid' };
  if (record.completedAt < record.requestedAt) return { valid: false, reason: 'recovery-time-invalid' };
  try {
    cleanText(record.method, 'recovery method');
    const evidence = [...new Set((record.evidenceIds ?? []).map((id) => cleanText(id, 'evidence ID')))].sort();
    if (evidence.length !== record.evidenceIds?.length || evidence.some((id, index) => id !== record.evidenceIds[index])) {
      return { valid: false, reason: 'recovery-evidence-noncanonical' };
    }
  } catch (error) {
    return { valid: false, reason: error.message };
  }
  if (options.policy) {
    const policy = await verifyRecoveryPolicy(options.policy);
    if (!policy.valid || options.policy.policyId !== record.policyId || options.policy.passportId !== record.passportId) {
      return { valid: false, reason: 'recovery-policy-mismatch' };
    }
    if (record.completedAt < record.requestedAt + options.policy.highRiskDelayMs) {
      return { valid: false, reason: 'recovery-delay-not-satisfied' };
    }
  }
  return { ...result, passportId: record.passportId };
}

/** Build a signed, allowlisted public Passport projection. */
export async function createRealmPassport(input, passportSigner) {
  assertRealmId(input?.passportId, REALM_ID_TYPE.USER, 'Passport ID');
  const record = {
    format: PASSPORT_FORMAT,
    passportId: input.passportId,
    publicName: cleanText(input.publicName ?? 'Unnamed', 'public name'),
    verifiedKeys: Object.freeze([...(input.verifiedKeys ?? [])].slice(0, MAX_LIST)),
    trustedDevices: Object.freeze([...(input.trustedDevices ?? [])].slice(0, MAX_LIST)),
    organizationMemberships: Object.freeze([...(input.organizationMemberships ?? [])].slice(0, MAX_LIST)),
    publicCapabilities: Object.freeze([...(input.publicCapabilities ?? [])].slice(0, MAX_LIST)),
    reputationSummaries: Object.freeze([...(input.reputationSummaries ?? [])].slice(0, MAX_LIST)),
    ownershipClaims: Object.freeze([...(input.ownershipClaims ?? [])].slice(0, MAX_LIST)),
    recoveryContacts: Object.freeze([...(input.recoveryContacts ?? [])].slice(0, MAX_LIST)),
    profile: Object.freeze({ avatar: String(input.profile?.avatar ?? ''), bio: String(input.profile?.bio ?? '') }),
    issuedAt: finiteTime(input.issuedAt ?? Date.now(), 'issuedAt'),
  };
  assertPublicValue(record);
  return signRecord(record, 'passportRecordId', PASSPORT_FORMAT, passportSigner);
}

export async function verifyRealmPassport(passport) {
  const result = await verifySignedRecord(passport, 'passportRecordId', PASSPORT_FORMAT, PASSPORT_FORMAT);
  if (!result.valid) return result;
  if (!isRealmId(passport.passportId, REALM_ID_TYPE.USER)) return { valid: false, reason: 'invalid-passport-id' };
  try { assertPublicValue(unsigned(passport, 'passportRecordId')); }
  catch (error) { return { valid: false, reason: error.message }; }
  return { ...result, passportId: passport.passportId };
}
