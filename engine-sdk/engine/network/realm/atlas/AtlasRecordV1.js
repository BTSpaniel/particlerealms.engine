// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/** Signed, bounded Realm Atlas publication records and visibility policy. */

import { byteSignature } from '../../../core/math/FormatMath.js';
import { verifyWithKey } from '../../../state/authority/Identity.js';
import { canonicalBytes, canonicalize, hashIdSecure, parseHashId } from '../../../state/util/canonical.js';
import {
  REALM_ID_TYPE,
  assertRealmId,
  isRealmId,
  realmKeyFingerprint,
} from '../addressing/RealmIds.js';

export const ATLAS_RECORD_FORMAT = 'realm-atlas-record-v1';
export const ATLAS_RECORD_MAX_BYTES = 64 * 1024;
export const ATLAS_RECORD_MAX_TTL_MS = 24 * 60 * 60 * 1000;
export const ATLAS_RECORD_MIN_TTL_MS = 1_000;

export const ATLAS_VISIBILITY = Object.freeze({
  PUBLIC: 'public',
  UNLISTED: 'unlisted',
  PRIVATE: 'private',
  ORGANIZATION_ONLY: 'organization-only',
  TRUSTED_CONTACT_ONLY: 'trusted-contact-only',
  INVITATION_ONLY: 'invitation-only',
  LOCAL_ONLY: 'local-only',
  ARCHIVED: 'archived',
  TEMPORARILY_SEALED: 'temporarily-sealed',
});

const VISIBILITIES = new Set(Object.values(ATLAS_VISIBILITY));
const IDENTITY_TYPES = Object.freeze([
  REALM_ID_TYPE.USER,
  REALM_ID_TYPE.NAVI,
  REALM_ID_TYPE.AGENT,
  REALM_ID_TYPE.ORGANIZATION,
]);
const RESOURCE_TYPES = new Set([
  REALM_ID_TYPE.ASSET,
  REALM_ID_TYPE.RECIPE,
  REALM_ID_TYPE.SKILL,
  REALM_ID_TYPE.PUBLICATION,
]);
const HASH_ID_RE = /^sha256:256:[0-9a-f]{64}$/;
const SCOPE_TAG_RE = /^[0-9a-f]{64}$/;
const SIGNATURE_RE = /^[0-9a-f]{128}$/;
const TOP_LEVEL_FIELDS = Object.freeze([
  'format', 'realmId', 'publisherId', 'organizationId', 'sequence', 'previousRecordId',
  'visibility', 'audience', 'details', 'issuedAt', 'expiresAt', 'signer', 'recordId', 'signatureHex',
]);
const DETAILS_FIELDS = Object.freeze([
  'title', 'purpose', 'creatorId', 'contributorIds', 'activities', 'authoritativeBranchId',
  'publicBranchIds', 'requiredResourceIds', 'estimatedDownloadBytes', 'performance', 'population',
  'regions', 'safetyClassification', 'ageClassification', 'moderationPolicy', 'modificationPolicy',
  'compatibleSkillIds', 'chronicleRoot', 'provenanceRoot', 'licenseIds', 'accessibilityFeatures',
  'offlineCapabilities', 'trust',
]);

export const AtlasRecordV1 = Object.freeze({
  name: 'AtlasRecordV1',
  format: ATLAS_RECORD_FORMAT,
  version: 1,
  maximumBytes: ATLAS_RECORD_MAX_BYTES,
  maximumLifetimeMs: ATLAS_RECORD_MAX_TTL_MS,
  visibilityModes: Object.freeze([...VISIBILITIES]),
});

function exactKeys(value, expected, name) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${name} must be an object`);
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (canonicalize(actual) !== canonicalize(wanted)) throw new TypeError(`${name} has unknown or missing fields`);
}

function safeInteger(value, name, minimum = 0, maximum = Number.MAX_SAFE_INTEGER) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < minimum || number > maximum) {
    throw new TypeError(`${name} must be a safe integer from ${minimum} through ${maximum}`);
  }
  return number;
}

function boundedText(value, name, maximum = 1024) {
  const text = String(value ?? '').normalize('NFKC').trim();
  if (!text || text.length > maximum) throw new TypeError(`${name} must contain 1 through ${maximum} characters`);
  return text;
}

function boundedToken(value, name, maximum = 96) {
  const token = String(value ?? '').normalize('NFKC').trim().toLowerCase();
  if (!token || token.length > maximum || !/^[a-z0-9][a-z0-9._:+-]*$/.test(token)) {
    throw new TypeError(`${name} must be a bounded lowercase token`);
  }
  return token;
}

function uniqueSorted(values, name, normalize, maximum = 128, allowEmpty = true) {
  if (!Array.isArray(values) || (!allowEmpty && values.length === 0) || values.length > maximum) {
    throw new TypeError(`${name} must be ${allowEmpty ? 'a' : 'a non-empty'} bounded array`);
  }
  const normalized = values.map((value, index) => normalize(value, `${name}[${index}]`));
  if (new Set(normalized).size !== normalized.length) throw new TypeError(`${name} must not contain duplicates`);
  return Object.freeze(normalized.sort());
}

function identityId(value, name) {
  if (!IDENTITY_TYPES.some(type => isRealmId(value, type))) {
    throw new TypeError(`${name} must be a user, Navi, agent, or organization Realm ID`);
  }
  return value;
}

function hashId(value, name) {
  if (typeof value !== 'string' || !HASH_ID_RE.test(value) || !parseHashId(value)) {
    throw new TypeError(`${name} must be a SHA-256 authority hash ID`);
  }
  return value;
}

function optionalHashId(value, name) {
  return value === null || value === undefined ? null : hashId(value, name);
}

function normalizeAudience(value = {}) {
  const audience = value ?? {};
  const keys = Object.keys(audience);
  if (keys.some(key => !['organizationIds', 'contactIds', 'scopeTags'].includes(key))) {
    throw new TypeError('Atlas audience contains unsupported fields');
  }
  return Object.freeze({
    organizationIds: uniqueSorted(audience.organizationIds ?? [], 'audience.organizationIds',
      (id, name) => assertRealmId(id, REALM_ID_TYPE.ORGANIZATION, name), 32),
    contactIds: uniqueSorted(audience.contactIds ?? [], 'audience.contactIds', identityId, 128),
    scopeTags: uniqueSorted(audience.scopeTags ?? [], 'audience.scopeTags', (tag, name) => {
      const normalized = String(tag ?? '').toLowerCase();
      if (!SCOPE_TAG_RE.test(normalized)) throw new TypeError(`${name} must be lowercase SHA-256 hex`);
      return normalized;
    }, 32),
  });
}

function enforceVisibilityAudience(visibility, audience, organizationId) {
  const hasOrganizations = audience.organizationIds.length > 0;
  const hasContacts = audience.contactIds.length > 0;
  const hasScopes = audience.scopeTags.length > 0;
  if (visibility === ATLAS_VISIBILITY.ORGANIZATION_ONLY) {
    if (!organizationId || !hasOrganizations || !audience.organizationIds.includes(organizationId)) {
      throw new TypeError('organization-only Atlas records must include their owning organization in the audience');
    }
    if (hasContacts) throw new TypeError('organization-only Atlas records cannot contain contact audiences');
  } else if (visibility === ATLAS_VISIBILITY.TRUSTED_CONTACT_ONLY) {
    if (!hasContacts) throw new TypeError('trusted-contact-only Atlas records require at least one contact');
    if (hasOrganizations) throw new TypeError('trusted-contact-only Atlas records cannot contain organization audiences');
  } else if ([ATLAS_VISIBILITY.UNLISTED, ATLAS_VISIBILITY.INVITATION_ONLY].includes(visibility)) {
    if (!hasScopes) throw new TypeError(`${visibility} Atlas records require at least one opaque scope tag`);
    if (hasOrganizations || hasContacts) throw new TypeError(`${visibility} Atlas records use opaque scopes, not identity audiences`);
  } else if ([ATLAS_VISIBILITY.PRIVATE, ATLAS_VISIBILITY.LOCAL_ONLY].includes(visibility)) {
    if (hasOrganizations || hasContacts || hasScopes) throw new TypeError(`${visibility} Atlas records cannot contain distribution audiences`);
  } else if (hasOrganizations || hasContacts) {
    throw new TypeError(`${visibility} Atlas records cannot contain identity audiences`);
  }
}

function normalizePerformance(value = {}) {
  const input = value ?? {};
  const keys = Object.keys(input);
  if (keys.some(key => !['profile', 'expectedFps', 'minimumMemoryBytes'].includes(key))) {
    throw new TypeError('details.performance contains unsupported fields');
  }
  return Object.freeze({
    profile: boundedToken(input.profile ?? 'unspecified', 'details.performance.profile'),
    expectedFps: safeInteger(input.expectedFps ?? 0, 'details.performance.expectedFps', 0, 1000),
    minimumMemoryBytes: safeInteger(input.minimumMemoryBytes ?? 0, 'details.performance.minimumMemoryBytes', 0),
  });
}

function normalizePopulation(value = {}) {
  const input = value ?? {};
  const keys = Object.keys(input);
  if (keys.some(key => !['active', 'capacity', 'measuredAt'].includes(key))) {
    throw new TypeError('details.population contains unsupported fields');
  }
  const active = safeInteger(input.active ?? 0, 'details.population.active', 0, 1_000_000_000);
  const capacity = safeInteger(input.capacity ?? 0, 'details.population.capacity', 0, 1_000_000_000);
  if (capacity > 0 && active > capacity) throw new RangeError('details.population.active cannot exceed capacity');
  return Object.freeze({
    active,
    capacity,
    measuredAt: safeInteger(input.measuredAt ?? 0, 'details.population.measuredAt'),
  });
}

function normalizeRegions(values = []) {
  if (!Array.isArray(values) || values.length > 32) throw new TypeError('details.regions must contain at most 32 entries');
  const seen = new Set();
  const regions = values.map((value, index) => {
    exactKeys(value, ['region', 'latencyMs'], `details.regions[${index}]`);
    const region = boundedToken(value.region, `details.regions[${index}].region`, 64);
    if (seen.has(region)) throw new TypeError('details.regions must not contain duplicate regions');
    seen.add(region);
    return Object.freeze({
      region,
      latencyMs: safeInteger(value.latencyMs, `details.regions[${index}].latencyMs`, 0, 600_000),
    });
  });
  return Object.freeze(regions.sort((a, b) => a.region.localeCompare(b.region)));
}

function normalizeTrust(value = {}) {
  const input = value ?? {};
  const keys = Object.keys(input);
  if (keys.some(key => !['status', 'evidenceIds'].includes(key))) throw new TypeError('details.trust contains unsupported fields');
  return Object.freeze({
    status: boundedToken(input.status ?? 'unverified', 'details.trust.status'),
    evidenceIds: uniqueSorted(input.evidenceIds ?? [], 'details.trust.evidenceIds', hashId, 64),
  });
}

function normalizeDetails(value) {
  exactKeys(value, DETAILS_FIELDS, 'Atlas details');
  const creatorId = identityId(value.creatorId, 'details.creatorId');
  return Object.freeze({
    title: boundedText(value.title, 'details.title', 160),
    purpose: boundedText(value.purpose, 'details.purpose', 2048),
    creatorId,
    contributorIds: uniqueSorted(value.contributorIds, 'details.contributorIds', identityId, 128),
    activities: uniqueSorted(value.activities, 'details.activities', boundedToken, 128, false),
    authoritativeBranchId: assertRealmId(value.authoritativeBranchId, REALM_ID_TYPE.BRANCH,
      'details.authoritativeBranchId'),
    publicBranchIds: uniqueSorted(value.publicBranchIds, 'details.publicBranchIds',
      (id, name) => assertRealmId(id, REALM_ID_TYPE.BRANCH, name), 128),
    requiredResourceIds: uniqueSorted(value.requiredResourceIds, 'details.requiredResourceIds', (id, name) => {
      const parsed = IDENTITY_TYPES.find(type => isRealmId(id, type));
      const resourceType = Object.values(REALM_ID_TYPE).find(type => isRealmId(id, type));
      if (parsed || !RESOURCE_TYPES.has(resourceType)) throw new TypeError(`${name} must be an asset, recipe, skill, or publication ID`);
      return id;
    }, 512),
    estimatedDownloadBytes: safeInteger(value.estimatedDownloadBytes, 'details.estimatedDownloadBytes'),
    performance: normalizePerformance(value.performance),
    population: normalizePopulation(value.population),
    regions: normalizeRegions(value.regions),
    safetyClassification: boundedToken(value.safetyClassification, 'details.safetyClassification'),
    ageClassification: boundedToken(value.ageClassification, 'details.ageClassification'),
    moderationPolicy: boundedText(value.moderationPolicy, 'details.moderationPolicy', 2048),
    modificationPolicy: boundedText(value.modificationPolicy, 'details.modificationPolicy', 2048),
    compatibleSkillIds: uniqueSorted(value.compatibleSkillIds, 'details.compatibleSkillIds',
      (id, name) => assertRealmId(id, REALM_ID_TYPE.SKILL, name), 128),
    chronicleRoot: hashId(value.chronicleRoot, 'details.chronicleRoot'),
    provenanceRoot: hashId(value.provenanceRoot, 'details.provenanceRoot'),
    licenseIds: uniqueSorted(value.licenseIds, 'details.licenseIds',
      (item, name) => boundedText(item, name, 128), 64, false),
    accessibilityFeatures: uniqueSorted(value.accessibilityFeatures, 'details.accessibilityFeatures', boundedToken, 128),
    offlineCapabilities: uniqueSorted(value.offlineCapabilities, 'details.offlineCapabilities', boundedToken, 128),
    trust: normalizeTrust(value.trust),
  });
}

function normalizeCore(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new TypeError('Atlas record input must be an object');
  const visibility = String(input.visibility ?? '').toLowerCase();
  if (!VISIBILITIES.has(visibility)) throw new TypeError(`unsupported Atlas visibility: ${visibility || '(empty)'}`);
  const realmId = assertRealmId(input.realmId, REALM_ID_TYPE.REALM, 'realmId');
  const publisherId = identityId(input.publisherId, 'publisherId');
  const organizationId = input.organizationId === null || input.organizationId === undefined
    ? null
    : assertRealmId(input.organizationId, REALM_ID_TYPE.ORGANIZATION, 'organizationId');
  const sequence = safeInteger(input.sequence ?? 0, 'sequence');
  const previousRecordId = optionalHashId(input.previousRecordId, 'previousRecordId');
  if ((sequence === 0) !== (previousRecordId === null)) {
    throw new TypeError('Atlas record sequence zero must have no predecessor and later records must name one');
  }
  const issuedAt = safeInteger(input.issuedAt ?? Date.now(), 'issuedAt');
  const expiresAt = safeInteger(input.expiresAt, 'expiresAt');
  const lifetime = expiresAt - issuedAt;
  if (lifetime < ATLAS_RECORD_MIN_TTL_MS || lifetime > ATLAS_RECORD_MAX_TTL_MS) {
    throw new RangeError(`Atlas lifetime must be ${ATLAS_RECORD_MIN_TTL_MS}..${ATLAS_RECORD_MAX_TTL_MS} ms`);
  }
  const audience = normalizeAudience(input.audience);
  enforceVisibilityAudience(visibility, audience, organizationId);
  const details = normalizeDetails(input.details);
  if (details.creatorId !== publisherId && !details.contributorIds.includes(publisherId)
    && organizationId !== publisherId) {
    throw new TypeError('publisherId must be the creator, a contributor, or the owning organization');
  }
  if (organizationId && publisherId === organizationId && !isRealmId(publisherId, REALM_ID_TYPE.ORGANIZATION)) {
    throw new TypeError('organization publishers must use an organization Realm ID');
  }
  return Object.freeze({
    format: ATLAS_RECORD_FORMAT,
    realmId,
    publisherId,
    organizationId,
    sequence,
    previousRecordId,
    visibility,
    audience,
    details,
    issuedAt,
    expiresAt,
  });
}

function signatureHex(value) {
  let hex = value;
  if (value instanceof ArrayBuffer || ArrayBuffer.isView(value)) {
    hex = byteSignature(value instanceof ArrayBuffer ? new Uint8Array(value) : value);
  }
  hex = String(hex ?? '').toLowerCase();
  if (!SIGNATURE_RE.test(hex)) throw new TypeError('Atlas signature must be a 64-byte lowercase ECDSA signature');
  return hex;
}

async function signerDescriptor(signer) {
  if (!signer || signer.secure === false || typeof signer.sign !== 'function') {
    throw new Error('a secure Atlas signer is required');
  }
  const publicKeyHex = String(signer.publicKeyHex ?? '').toLowerCase();
  const fingerprint = await realmKeyFingerprint(publicKeyHex);
  if (signer.fingerprint && signer.fingerprint !== fingerprint) {
    throw new Error('Atlas signer fingerprint does not match its public key');
  }
  return Object.freeze({ publicKeyHex, fingerprint });
}

function unsignedRecord(record) {
  const value = { ...record };
  delete value.recordId;
  delete value.signatureHex;
  return value;
}

function recordSigningBytes(record) {
  return canonicalBytes(unsignedRecord(record), {
    domain: 'realm-network.atlas.signature',
    schemaVersion: ATLAS_RECORD_FORMAT,
  });
}

async function computeRecordId(record) {
  return hashIdSecure(unsignedRecord(record), {
    domain: 'realm-network.atlas.record',
    schemaVersion: ATLAS_RECORD_FORMAT,
  });
}

function recordByteLength(record) {
  return new TextEncoder().encode(canonicalize(record)).byteLength;
}

/** Create a signed immutable AtlasRecordV1. */
export async function createAtlasRecordV1(input, signer) {
  const core = normalizeCore(input);
  const signedCore = Object.freeze({ ...core, signer: await signerDescriptor(signer) });
  const recordId = await computeRecordId(signedCore);
  const signature = signatureHex(await signer.sign(recordSigningBytes(signedCore)));
  const record = Object.freeze({ ...signedCore, recordId, signatureHex: signature });
  if (recordByteLength(record) > ATLAS_RECORD_MAX_BYTES) throw new RangeError('Atlas record exceeds its canonical byte limit');
  return record;
}

/** Verify canonical structure, SHA-256 identity, signature, freshness, and optional publisher authority. */
export async function verifyAtlasRecordV1(record, {
  now = Date.now(),
  futureSkewMs = 30_000,
  authorizePublisher = null,
  allowExpired = false,
} = {}) {
  try {
    exactKeys(record, TOP_LEVEL_FIELDS, 'AtlasRecordV1');
    if (record.format !== ATLAS_RECORD_FORMAT) return Object.freeze({ valid: false, reason: 'format-invalid' });
    const normalized = normalizeCore(record);
    exactKeys(record.signer, ['publicKeyHex', 'fingerprint'], 'Atlas signer');
    const descriptor = await signerDescriptor({ ...record.signer, secure: true, sign() {} });
    const expectedUnsigned = { ...normalized, signer: descriptor };
    if (canonicalize(unsignedRecord(record)) !== canonicalize(expectedUnsigned)) {
      return Object.freeze({ valid: false, reason: 'record-noncanonical' });
    }
    if (!SIGNATURE_RE.test(record.signatureHex) || !HASH_ID_RE.test(record.recordId)) {
      return Object.freeze({ valid: false, reason: 'record-encoding-invalid' });
    }
    if (recordByteLength(record) > ATLAS_RECORD_MAX_BYTES) return Object.freeze({ valid: false, reason: 'record-oversize' });
    if (record.issuedAt > now + futureSkewMs) return Object.freeze({ valid: false, reason: 'record-from-future' });
    if (!allowExpired && record.expiresAt <= now) return Object.freeze({ valid: false, reason: 'record-expired' });
    const expectedId = await computeRecordId(record);
    if (record.recordId !== expectedId) return Object.freeze({ valid: false, reason: 'record-id-mismatch' });
    if (!(await verifyWithKey(record.signer.publicKeyHex, recordSigningBytes(record), record.signatureHex))) {
      return Object.freeze({ valid: false, reason: 'signature-invalid' });
    }
    if (authorizePublisher !== null) {
      if (typeof authorizePublisher !== 'function') return Object.freeze({ valid: false, reason: 'publisher-authorizer-invalid' });
      const result = await authorizePublisher(record, record.signer);
      if (result !== true && result?.valid !== true && result?.allowed !== true) {
        return Object.freeze({ valid: false, reason: result?.reason ?? 'publisher-unauthorized' });
      }
    }
    return Object.freeze({
      valid: true,
      recordId: record.recordId,
      realmId: record.realmId,
      signerFingerprint: record.signer.fingerprint,
    });
  } catch (error) {
    return Object.freeze({ valid: false, reason: error?.message ?? 'record-malformed' });
  }
}

function intersects(left, right) {
  const set = new Set(right ?? []);
  return (left ?? []).some(value => set.has(value));
}

export function atlasVisibilitySemantics(visibility) {
  if (!VISIBILITIES.has(visibility)) throw new TypeError('unknown Atlas visibility');
  return Object.freeze({
    discoverable: ![
      ATLAS_VISIBILITY.UNLISTED,
      ATLAS_VISIBILITY.PRIVATE,
      ATLAS_VISIBILITY.INVITATION_ONLY,
      ATLAS_VISIBILITY.LOCAL_ONLY,
    ].includes(visibility),
    entryAllowed: ![
      ATLAS_VISIBILITY.ARCHIVED,
      ATLAS_VISIBILITY.TEMPORARILY_SEALED,
    ].includes(visibility),
  });
}

/** Evaluate a viewer against the signed audience without granting entry permissions. */
export function canAccessAtlasRecordV1(record, context = {}) {
  const semantics = atlasVisibilitySemantics(record.visibility);
  const owner = context.viewerId === record.publisherId || context.viewerId === record.details?.creatorId;
  let allowed = false;
  let reason = 'visibility-denied';
  switch (record.visibility) {
    case ATLAS_VISIBILITY.PUBLIC:
    case ATLAS_VISIBILITY.ARCHIVED:
    case ATLAS_VISIBILITY.TEMPORARILY_SEALED:
      allowed = true;
      reason = null;
      break;
    case ATLAS_VISIBILITY.UNLISTED:
    case ATLAS_VISIBILITY.INVITATION_ONLY:
      allowed = owner || (context.directLookup === true && intersects(record.audience.scopeTags, context.scopeTags));
      reason = allowed ? null : 'opaque-scope-required';
      break;
    case ATLAS_VISIBILITY.PRIVATE:
      allowed = owner;
      reason = allowed ? null : 'publisher-only';
      break;
    case ATLAS_VISIBILITY.ORGANIZATION_ONLY:
      allowed = owner || intersects(record.audience.organizationIds, context.organizationIds);
      reason = allowed ? null : 'organization-membership-required';
      break;
    case ATLAS_VISIBILITY.TRUSTED_CONTACT_ONLY:
      allowed = owner || record.audience.contactIds.includes(context.viewerId);
      reason = allowed ? null : 'trusted-contact-required';
      break;
    case ATLAS_VISIBILITY.LOCAL_ONLY:
      allowed = owner && context.local === true;
      reason = allowed ? null : 'local-owner-required';
      break;
    default:
      allowed = false;
  }
  return Object.freeze({ allowed, reason, ...semantics });
}

/** Monotonic per-publisher replay guard for verified Atlas histories. */
export class AtlasReplayGuard {
  constructor({ authorizePublisher = null, now = () => Date.now(), acceptSnapshots = true } = {}) {
    if (typeof now !== 'function') throw new TypeError('Atlas replay clock must be a function');
    this._authorizePublisher = authorizePublisher;
    this._now = now;
    this._acceptSnapshots = acceptSnapshots === true;
    this._current = new Map();
    this._seen = new Set();
  }

  _key(record) {
    return `${record.realmId}\u0000${record.publisherId}`;
  }

  async accept(record) {
    const verification = await verifyAtlasRecordV1(record, {
      now: this._now(),
      authorizePublisher: this._authorizePublisher,
    });
    if (!verification.valid) return Object.freeze({ accepted: false, duplicate: false, gap: false, reason: verification.reason });
    if (this._seen.has(record.recordId)) {
      return Object.freeze({ accepted: false, duplicate: true, gap: false, reason: 'record-replay' });
    }
    const key = this._key(record);
    const current = this._current.get(key) ?? null;
    if (!current) {
      if (record.sequence > 0 && !this._acceptSnapshots) {
        return Object.freeze({ accepted: false, duplicate: false, gap: true, reason: 'predecessor-missing' });
      }
    } else if (record.sequence <= current.sequence) {
      return Object.freeze({ accepted: false, duplicate: false, gap: false, reason: 'sequence-replay' });
    } else if (record.sequence !== current.sequence + 1 || record.previousRecordId !== current.recordId) {
      return Object.freeze({ accepted: false, duplicate: false, gap: true, reason: 'history-diverged' });
    } else if (record.issuedAt < current.issuedAt) {
      return Object.freeze({ accepted: false, duplicate: false, gap: false, reason: 'clock-regressed' });
    }
    const gap = !current && record.sequence > 0;
    this._current.set(key, record);
    this._seen.add(record.recordId);
    return Object.freeze({ accepted: true, duplicate: false, gap, reason: gap ? 'snapshot-gap' : null });
  }

  current(realmId, publisherId) {
    return this._current.get(`${realmId}\u0000${publisherId}`) ?? null;
  }

  remove(recordId) {
    for (const [key, record] of this._current) {
      if (record.recordId !== recordId) continue;
      this._current.delete(key);
      this._seen.delete(recordId);
      return true;
    }
    return false;
  }
}
