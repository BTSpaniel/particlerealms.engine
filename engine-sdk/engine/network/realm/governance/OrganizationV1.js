// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/** Signed OrganizationV1 root contract and its fixed governance vocabulary. */

import {
  REALM_ID_TYPE,
  assertRealmId,
  isRealmId,
} from '../addressing/RealmIds.js';
import {
  boundedInteger,
  boundedText,
  boundedToken,
  finishSignedRecord,
  signerDescriptor,
  uniqueSorted,
  verifySignedRecord,
} from './GovernanceCrypto.js';

export const ORGANIZATION_V1_FORMAT = 'realm-organization-v1';

export const ORGANIZATION_POWER = Object.freeze({
  VIEW: 'view',
  EDIT: 'edit',
  SCRIPT: 'script',
  MODERATE: 'moderate',
  PUBLISH: 'publish',
  ADMIN: 'admin',
});

const POWERS = new Set(Object.values(ORGANIZATION_POWER));

export const DEFAULT_ORGANIZATION_ROLES = Object.freeze({
  owner: Object.freeze({ powers: Object.freeze(Object.values(ORGANIZATION_POWER).sort()), canVote: true }),
  administrator: Object.freeze({ powers: Object.freeze(Object.values(ORGANIZATION_POWER).sort()), canVote: true }),
  moderator: Object.freeze({ powers: Object.freeze(['moderate', 'view']), canVote: true }),
  publisher: Object.freeze({ powers: Object.freeze(['publish', 'view']), canVote: true }),
  editor: Object.freeze({ powers: Object.freeze(['edit', 'view']), canVote: true }),
  scripter: Object.freeze({ powers: Object.freeze(['script', 'view']), canVote: true }),
  member: Object.freeze({ powers: Object.freeze(['view']), canVote: true }),
  viewer: Object.freeze({ powers: Object.freeze(['view']), canVote: false }),
});

const OWNER_TYPES = [
  REALM_ID_TYPE.USER,
  REALM_ID_TYPE.AGENT,
  REALM_ID_TYPE.ORGANIZATION,
];

function assertOwnerIdentity(identityId) {
  if (!OWNER_TYPES.some(type => isRealmId(identityId, type))) {
    throw new TypeError('Organization owner must be a user, agent, or organization Realm ID');
  }
  return identityId;
}

function normalizeRoleDefinitions(input = DEFAULT_ORGANIZATION_ROLES) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new TypeError('Organization roles must be an object');
  const entries = Object.entries(input);
  if (entries.length === 0 || entries.length > 64) throw new TypeError('Organization roles must contain 1 to 64 roles');
  const roles = {};
  for (const [rawName, definition] of entries) {
    const name = boundedToken(rawName, 'role name', 64);
    if (!definition || typeof definition !== 'object' || Array.isArray(definition)) throw new TypeError(`Role ${name} is malformed`);
    const powers = uniqueSorted(definition.powers, `role ${name} powers`, (value) => {
      const power = boundedToken(value, 'organization power', 32);
      if (!POWERS.has(power)) throw new TypeError(`Unsupported organization power: ${power}`);
      return power;
    }, POWERS.size);
    roles[name] = Object.freeze({ powers, canVote: definition.canVote === true });
  }
  if (!roles.owner || !roles.owner.powers.includes(ORGANIZATION_POWER.ADMIN)) {
    throw new TypeError('Organization owner role must exist and include admin power');
  }
  return Object.freeze(Object.fromEntries(Object.entries(roles).sort(([a], [b]) => a.localeCompare(b))));
}

function normalizeConstitution(value = {}, roles) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('Organization constitution must be an object');
  const numerator = boundedInteger(value.quorumNumerator ?? 1, 'quorumNumerator', 1);
  const denominator = boundedInteger(value.quorumDenominator ?? 2, 'quorumDenominator', 1);
  if (numerator > denominator) throw new RangeError('Organization quorum numerator cannot exceed its denominator');
  const minApprovals = boundedInteger(value.minApprovals ?? 1, 'minApprovals', 1);
  if (minApprovals > 4096) throw new RangeError('Organization minApprovals exceeds the membership bound');
  const proposalTtlMs = boundedInteger(value.proposalTtlMs ?? 7 * 24 * 60 * 60 * 1000, 'proposalTtlMs', 1000);
  if (proposalTtlMs > 30 * 24 * 60 * 60 * 1000) throw new RangeError('Organization proposal TTL exceeds 30 days');
  const eligibleRoles = value.eligibleRoles == null
    ? Object.entries(roles).filter(([, definition]) => definition.canVote).map(([name]) => name)
    : uniqueSorted(value.eligibleRoles, 'eligibleRoles', role => boundedToken(role, 'eligible role', 64), 64);
  for (const role of eligibleRoles) {
    if (!roles[role] || !roles[role].canVote) throw new TypeError(`Role ${role} is not vote eligible`);
  }
  return Object.freeze({
    quorumNumerator: numerator,
    quorumDenominator: denominator,
    minApprovals,
    proposalTtlMs,
    eligibleRoles: Object.freeze([...eligibleRoles].sort()),
    allowMemberProposals: value.allowMemberProposals !== false,
  });
}

function normalizeOrganizationInput(input, ownerDescriptor = null) {
  const roles = normalizeRoleDefinitions(input.roles ?? DEFAULT_ORGANIZATION_ROLES);
  const createdAt = boundedInteger(input.createdAt ?? Date.now(), 'createdAt');
  const ownerKeyFingerprint = String(input.ownerKeyFingerprint ?? ownerDescriptor?.fingerprint ?? '').toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(ownerKeyFingerprint)) throw new TypeError('Organization owner key fingerprint is invalid');
  return {
    format: ORGANIZATION_V1_FORMAT,
    organizationId: assertRealmId(input.organizationId, REALM_ID_TYPE.ORGANIZATION, 'Organization ID'),
    name: boundedText(input.name, 'Organization name', 160),
    createdAt,
    ownerIdentityId: assertOwnerIdentity(input.ownerIdentityId),
    ownerMembershipId: assertRealmId(input.ownerMembershipId, REALM_ID_TYPE.MEMBERSHIP, 'Owner membership ID'),
    ownerKeyFingerprint,
    roles,
    constitution: normalizeConstitution(input.constitution ?? {}, roles),
    metadata: input.metadata == null ? Object.freeze({}) : normalizeMetadata(input.metadata),
  };
}

function normalizeMetadata(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('Organization metadata must be an object');
  const entries = Object.entries(value);
  if (entries.length > 32) throw new TypeError('Organization metadata exceeds 32 entries');
  const normalized = {};
  for (const [rawKey, rawValue] of entries) {
    const key = boundedToken(rawKey, 'metadata key', 64);
    normalized[key] = boundedText(rawValue, `metadata ${key}`, 512);
  }
  return Object.freeze(Object.fromEntries(Object.entries(normalized).sort(([a], [b]) => a.localeCompare(b))));
}

export async function createOrganizationV1(input, signer) {
  const descriptor = await signerDescriptor(signer);
  const normalized = normalizeOrganizationInput(input, descriptor);
  return finishSignedRecord(normalized, 'organizationRecordId', signer);
}

export async function verifyOrganizationV1(record) {
  const verified = await verifySignedRecord(record, {
    format: ORGANIZATION_V1_FORMAT,
    idField: 'organizationRecordId',
  });
  if (!verified.valid) return verified;
  try {
    const normalized = normalizeOrganizationInput(record);
    if (record.signer.fingerprint !== normalized.ownerKeyFingerprint) {
      return { valid: false, reason: 'owner-key-mismatch' };
    }
    return { ...verified, organization: Object.freeze(normalized) };
  } catch (error) {
    return { valid: false, reason: error?.message ?? 'organization-invalid' };
  }
}

/** Public contract descriptor for callers that discover schemas dynamically. */
export const OrganizationV1 = Object.freeze({
  format: ORGANIZATION_V1_FORMAT,
  create: createOrganizationV1,
  verify: verifyOrganizationV1,
  powers: ORGANIZATION_POWER,
});
