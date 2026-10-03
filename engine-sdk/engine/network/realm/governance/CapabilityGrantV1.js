// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/** Scoped, attenuable, delegable, revocable CapabilityGrantV1 contracts. */

import { hashIdSecure } from '../../../state/util/canonical.js';
import {
  REALM_ID_TYPE,
  assertRealmId,
  isRealmId,
} from '../addressing/RealmIds.js';
import { ORGANIZATION_POWER } from './OrganizationV1.js';
import {
  boundedInteger,
  boundedText,
  boundedToken,
  finishSignedRecord,
  uniqueSorted,
  verifySignedRecord,
} from './GovernanceCrypto.js';

export const CAPABILITY_GRANT_V1_FORMAT = 'realm-capability-grant-v1';
export const CAPABILITY_REVOCATION_V1_FORMAT = 'realm-capability-revocation-v1';
export const CAPABILITY_AUDIT_RECEIPT_V1_FORMAT = 'realm-capability-audit-receipt-v1';

const POWERS = new Set(Object.values(ORGANIZATION_POWER));
const ACTOR_TYPES = [REALM_ID_TYPE.USER, REALM_ID_TYPE.AGENT, REALM_ID_TYPE.ORGANIZATION];
const HASH_ID = /^sha256:256:[0-9a-f]{64}$/;

function assertActorId(value, label, nullable = false) {
  if (nullable && value == null) return null;
  if (!ACTOR_TYPES.some(type => isRealmId(value, type))) {
    throw new TypeError(`${label} must be a user, agent, or organization Realm ID`);
  }
  return value;
}

function optionalMembership(value, label) {
  return value == null ? null : assertRealmId(value, REALM_ID_TYPE.MEMBERSHIP, label);
}

function normalizeSubject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('Capability subject must be an object');
  const subject = Object.freeze({
    identityId: assertActorId(value.identityId, 'Capability subject identity', true),
    membershipId: optionalMembership(value.membershipId, 'Capability subject membership'),
    role: value.role == null ? null : boundedToken(value.role, 'Capability subject role', 64),
  });
  if (!subject.identityId && !subject.membershipId && !subject.role) {
    throw new TypeError('Capability subject must constrain identity, membership, or role');
  }
  return subject;
}

function normalizeWildcardRealm(value, name, expectedType = null) {
  if (value === '*') return value;
  return assertRealmId(value, expectedType, name);
}

function normalizeScope(value = {}) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('Capability scope must be an object');
  return Object.freeze({
    objects: uniqueSorted(value.objects ?? ['*'], 'Capability objects', item => normalizeWildcardRealm(item, 'Capability object'), 256),
    zones: uniqueSorted(value.zones ?? ['*'], 'Capability zones', item => boundedToken(item, 'Capability zone', 128, { wildcard: true }), 256),
    actions: uniqueSorted(value.actions ?? ['*'], 'Capability actions', item => boundedToken(item, 'Capability action', 128, { wildcard: true }), 128),
    branches: uniqueSorted(value.branches ?? ['*'], 'Capability branches', item => normalizeWildcardRealm(item, 'Capability branch', REALM_ID_TYPE.BRANCH), 64),
    domains: uniqueSorted(value.domains ?? ['*'], 'Capability domains', item => boundedToken(item, 'Capability domain', 128, { wildcard: true }), 64),
  });
}

function normalizePowers(values) {
  return uniqueSorted(values, 'Capability powers', (value) => {
    const power = boundedToken(value, 'Capability power', 32);
    if (!POWERS.has(power)) throw new TypeError(`Unsupported capability power: ${power}`);
    return power;
  }, POWERS.size);
}

function optionalHashId(value, name) {
  if (value == null) return null;
  const id = String(value);
  if (!HASH_ID.test(id)) throw new TypeError(`${name} is invalid`);
  return id;
}

function normalizeGrant(input) {
  const issuedAt = boundedInteger(input.issuedAt ?? Date.now(), 'Capability issuedAt');
  const notBefore = boundedInteger(input.notBefore ?? issuedAt, 'Capability notBefore');
  const expiresAt = boundedInteger(input.expiresAt, 'Capability expiresAt', notBefore + 1);
  if (notBefore < issuedAt) throw new RangeError('Capability cannot begin before it is issued');
  const maxDelegationDepth = boundedInteger(input.maxDelegationDepth ?? 0, 'Capability maxDelegationDepth');
  if (maxDelegationDepth > 16) throw new RangeError('Capability delegation depth exceeds 16');
  const delegationDepth = boundedInteger(input.delegationDepth ?? 0, 'Capability delegationDepth');
  if (delegationDepth > maxDelegationDepth) throw new RangeError('Capability delegation depth exceeds its limit');
  const parentGrantId = optionalHashId(input.parentGrantId, 'Capability parent grant ID');
  const recoveryOf = optionalHashId(input.recoveryOf, 'Capability recovery grant ID');
  if (parentGrantId && recoveryOf) throw new TypeError('Capability cannot be a delegation and a recovery simultaneously');
  if (!!parentGrantId !== (delegationDepth > 0)) throw new TypeError('Delegated capabilities must identify exactly one parent');
  return {
    format: CAPABILITY_GRANT_V1_FORMAT,
    organizationId: assertRealmId(input.organizationId, REALM_ID_TYPE.ORGANIZATION, 'Organization ID'),
    issuerIdentityId: assertActorId(input.issuerIdentityId, 'Capability issuer identity'),
    issuerMembershipId: assertRealmId(input.issuerMembershipId, REALM_ID_TYPE.MEMBERSHIP, 'Capability issuer membership'),
    subject: normalizeSubject(input.subject),
    scope: normalizeScope(input.scope),
    powers: normalizePowers(input.powers),
    issuedAt,
    notBefore,
    expiresAt,
    delegable: input.delegable === true,
    maxDelegationDepth,
    delegationDepth,
    parentGrantId,
    recoveryOf,
    purpose: boundedText(input.purpose, 'Capability purpose', 512),
  };
}

function listIsNarrower(parent, child) {
  if (parent.includes('*')) return true;
  if (child.includes('*')) return false;
  const allowed = new Set(parent);
  return child.every(item => allowed.has(item));
}

function assertNarrower(parent, child, { recovery = false } = {}) {
  if (parent.organizationId !== child.organizationId) throw new Error('Capability organization cannot change');
  if (!listIsNarrower(parent.powers, child.powers)) throw new Error('Capability powers were widened');
  for (const field of ['objects', 'zones', 'actions', 'branches', 'domains']) {
    if (!listIsNarrower(parent.scope[field], child.scope[field])) throw new Error(`Capability ${field} scope was widened`);
  }
  if (child.notBefore < parent.notBefore || child.expiresAt > parent.expiresAt) throw new Error('Capability time scope was widened');
  if (child.maxDelegationDepth > parent.maxDelegationDepth) throw new Error('Capability delegation limit was widened');
  if (recovery && child.delegationDepth > parent.delegationDepth) throw new Error('Recovered capability cannot increase delegation depth');
  if (!recovery && child.delegationDepth !== parent.delegationDepth + 1) throw new Error('Capability delegation depth is invalid');
  return child;
}

export async function createCapabilityGrant(input, signer) {
  return finishSignedRecord(normalizeGrant(input), 'grantId', signer);
}

export async function verifyCapabilityGrant(record, options = {}) {
  const verified = await verifySignedRecord(record, {
    format: CAPABILITY_GRANT_V1_FORMAT,
    idField: 'grantId',
  });
  if (!verified.valid) return verified;
  try {
    const grant = Object.freeze(normalizeGrant(record));
    const now = boundedInteger(options.now ?? Date.now(), 'Capability verification time');
    if (!options.allowFuture && now < grant.notBefore) return { valid: false, reason: 'capability-not-yet-valid' };
    if (!options.allowExpired && now >= grant.expiresAt) return { valid: false, reason: 'capability-expired' };
    if (grant.parentGrantId) {
      const parent = options.parent
        ?? (typeof options.resolveParent === 'function' ? await options.resolveParent(grant.parentGrantId) : null);
      if (!parent || parent.grantId !== grant.parentGrantId) return { valid: false, reason: 'capability-parent-required' };
      const parentCheck = await verifyCapabilityGrant(parent, {
        now,
        allowExpired: true,
        allowFuture: true,
        resolveParent: options.resolveParent,
      });
      if (!parentCheck.valid) return { valid: false, reason: `capability-parent-${parentCheck.reason}` };
      if (!parentCheck.grant.delegable) return { valid: false, reason: 'capability-parent-not-delegable' };
      assertNarrower(parentCheck.grant, grant);
    }
    if (typeof options.authorizeIssuer === 'function'
      && !(await options.authorizeIssuer(grant.issuerMembershipId, grant.issuerIdentityId, record.signer.fingerprint, grant))) {
      return { valid: false, reason: 'capability-issuer-unauthorized' };
    }
    return { ...verified, grant };
  } catch (error) {
    return { valid: false, reason: error?.message ?? 'capability-invalid' };
  }
}

export async function attenuateCapabilityGrant(parentRecord, input, signer) {
  const parentCheck = await verifyCapabilityGrant(parentRecord, {
    allowExpired: true,
    allowFuture: true,
    resolveParent: input.resolveParent,
  });
  if (!parentCheck.valid) throw new Error(`Cannot delegate invalid capability: ${parentCheck.reason}`);
  const parent = parentCheck.grant;
  if (!parent.delegable || parent.delegationDepth >= parent.maxDelegationDepth) {
    throw new Error('Capability cannot be delegated further');
  }
  const issuedAt = boundedInteger(input.issuedAt ?? Date.now(), 'Delegated capability issuedAt');
  const child = normalizeGrant({
    organizationId: parent.organizationId,
    issuerIdentityId: input.issuerIdentityId,
    issuerMembershipId: input.issuerMembershipId,
    subject: input.subject,
    scope: input.scope ?? parent.scope,
    powers: input.powers ?? parent.powers,
    issuedAt,
    notBefore: input.notBefore ?? Math.max(parent.notBefore, issuedAt),
    expiresAt: input.expiresAt ?? parent.expiresAt,
    delegable: input.delegable === true,
    maxDelegationDepth: parent.maxDelegationDepth,
    delegationDepth: parent.delegationDepth + 1,
    parentGrantId: parentRecord.grantId,
    recoveryOf: null,
    purpose: input.purpose,
  });
  assertNarrower(parent, child);
  return finishSignedRecord(child, 'grantId', signer);
}

export async function recoverCapabilityGrant(previousRecord, input, signer) {
  const previousCheck = await verifyCapabilityGrant(previousRecord, {
    allowExpired: true,
    allowFuture: true,
    resolveParent: input.resolveParent,
  });
  if (!previousCheck.valid) throw new Error(`Cannot recover invalid capability: ${previousCheck.reason}`);
  const previous = previousCheck.grant;
  const issuedAt = boundedInteger(input.issuedAt ?? Date.now(), 'Recovered capability issuedAt');
  const replacement = normalizeGrant({
    organizationId: previous.organizationId,
    issuerIdentityId: input.issuerIdentityId,
    issuerMembershipId: input.issuerMembershipId,
    subject: input.subject ?? previous.subject,
    scope: input.scope ?? previous.scope,
    powers: input.powers ?? previous.powers,
    issuedAt,
    notBefore: input.notBefore ?? issuedAt,
    expiresAt: input.expiresAt,
    delegable: input.delegable === true,
    maxDelegationDepth: Math.max(0, previous.maxDelegationDepth - previous.delegationDepth),
    delegationDepth: 0,
    parentGrantId: null,
    recoveryOf: previousRecord.grantId,
    purpose: input.purpose,
  });
  assertNarrower(previous, replacement, { recovery: true });
  return finishSignedRecord(replacement, 'grantId', signer);
}

function normalizeRevocation(input) {
  return {
    format: CAPABILITY_REVOCATION_V1_FORMAT,
    organizationId: assertRealmId(input.organizationId, REALM_ID_TYPE.ORGANIZATION, 'Organization ID'),
    grantId: optionalHashId(input.grantId, 'Revoked grant ID'),
    issuerIdentityId: assertActorId(input.issuerIdentityId, 'Revocation issuer identity'),
    issuerMembershipId: assertRealmId(input.issuerMembershipId, REALM_ID_TYPE.MEMBERSHIP, 'Revocation issuer membership'),
    revokedAt: boundedInteger(input.revokedAt ?? Date.now(), 'Capability revokedAt'),
    reason: boundedText(input.reason, 'Capability revocation reason', 1024),
  };
}

export async function createCapabilityRevocation(input, signer) {
  const normalized = normalizeRevocation(input);
  if (!normalized.grantId) throw new TypeError('Capability revocation requires a grant ID');
  return finishSignedRecord(normalized, 'revocationId', signer);
}

export async function verifyCapabilityRevocation(record, options = {}) {
  const verified = await verifySignedRecord(record, {
    format: CAPABILITY_REVOCATION_V1_FORMAT,
    idField: 'revocationId',
  });
  if (!verified.valid) return verified;
  try {
    const revocation = Object.freeze(normalizeRevocation(record));
    if (typeof options.authorizeIssuer === 'function'
      && !(await options.authorizeIssuer(revocation.issuerMembershipId, revocation.issuerIdentityId, record.signer.fingerprint, revocation))) {
      return { valid: false, reason: 'revocation-issuer-unauthorized' };
    }
    return { ...verified, revocation };
  } catch (error) {
    return { valid: false, reason: error?.message ?? 'capability-revocation-invalid' };
  }
}

function normalizeAuditRequest(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('Capability audit request must be an object');
  return Object.freeze({
    identityId: assertActorId(value.identityId, 'Audit subject identity', true),
    membershipId: optionalMembership(value.membershipId, 'Audit subject membership'),
    roles: Object.freeze(Array.isArray(value.roles) ? [...new Set(value.roles.map(role => boundedToken(role, 'Audit role', 64)))].sort() : []),
    object: value.object == null ? null : normalizeWildcardRealm(value.object, 'Audit object'),
    zone: value.zone == null ? null : boundedToken(value.zone, 'Audit zone', 128, { wildcard: true }),
    action: boundedToken(value.action, 'Audit action', 128, { wildcard: true }),
    branchId: value.branchId == null ? null : normalizeWildcardRealm(value.branchId, 'Audit branch', REALM_ID_TYPE.BRANCH),
    domain: value.domain == null ? null : boundedToken(value.domain, 'Audit domain', 128, { wildcard: true }),
    power: boundedToken(value.power, 'Audit power', 32),
  });
}

export async function createCapabilityAuditReceipt(input, signer) {
  const request = normalizeAuditRequest(input.request);
  const decision = boundedToken(input.decision, 'Capability audit decision', 16);
  if (!['allow', 'deny'].includes(decision)) throw new TypeError('Capability audit decision must be allow or deny');
  const record = {
    format: CAPABILITY_AUDIT_RECEIPT_V1_FORMAT,
    organizationId: assertRealmId(input.organizationId, REALM_ID_TYPE.ORGANIZATION, 'Organization ID'),
    grantId: optionalHashId(input.grantId, 'Audit grant ID'),
    evaluatorIdentityId: assertActorId(input.evaluatorIdentityId, 'Audit evaluator identity'),
    evaluatedAt: boundedInteger(input.evaluatedAt ?? Date.now(), 'Capability evaluatedAt'),
    request,
    requestHash: await hashIdSecure(request, {
      domain: 'realm-network.capability.audit-request',
      schemaVersion: CAPABILITY_AUDIT_RECEIPT_V1_FORMAT,
    }),
    decision,
    reason: boundedText(input.reason, 'Capability audit reason', 512),
  };
  if (!record.grantId) throw new TypeError('Capability audit receipt requires a grant ID');
  return finishSignedRecord(record, 'receiptId', signer);
}

export async function verifyCapabilityAuditReceipt(record, options = {}) {
  const verified = await verifySignedRecord(record, {
    format: CAPABILITY_AUDIT_RECEIPT_V1_FORMAT,
    idField: 'receiptId',
  });
  if (!verified.valid) return verified;
  try {
    const request = normalizeAuditRequest(record.request);
    const requestHash = await hashIdSecure(request, {
      domain: 'realm-network.capability.audit-request',
      schemaVersion: CAPABILITY_AUDIT_RECEIPT_V1_FORMAT,
    });
    if (requestHash !== record.requestHash) return { valid: false, reason: 'audit-request-hash-mismatch' };
    if (!['allow', 'deny'].includes(record.decision)) return { valid: false, reason: 'audit-decision-invalid' };
    assertRealmId(record.organizationId, REALM_ID_TYPE.ORGANIZATION, 'Organization ID');
    optionalHashId(record.grantId, 'Audit grant ID');
    assertActorId(record.evaluatorIdentityId, 'Audit evaluator identity');
    boundedInteger(record.evaluatedAt, 'Capability evaluatedAt');
    boundedText(record.reason, 'Capability audit reason', 512);
    if (typeof options.authorizeAuditor === 'function'
      && !(await options.authorizeAuditor(record.evaluatorIdentityId, record.signer.fingerprint, record))) {
      return { valid: false, reason: 'audit-evaluator-unauthorized' };
    }
    return { ...verified, request };
  } catch (error) {
    return { valid: false, reason: error?.message ?? 'capability-audit-invalid' };
  }
}

function subjectMatches(subject, context) {
  if (subject.identityId && subject.identityId !== context.identityId) return false;
  if (subject.membershipId && subject.membershipId !== context.membershipId) return false;
  if (subject.role && !(context.roles ?? []).includes(subject.role)) return false;
  return true;
}

function valueMatches(allowed, value) {
  return allowed.includes('*') || (value != null && allowed.includes(value));
}

function scopeMatches(grant, request) {
  return valueMatches(grant.scope.objects, request.object)
    && valueMatches(grant.scope.zones, request.zone)
    && valueMatches(grant.scope.actions, request.action)
    && valueMatches(grant.scope.branches, request.branchId)
    && valueMatches(grant.scope.domains, request.domain)
    && grant.powers.includes(request.power);
}

/** Runtime registry with online revocation and dynamic membership/role checks. */
export class RealmCapabilityRegistry {
  constructor({
    organizationId,
    resolveMembership,
    authorizeIssuer,
    authorizeAuditor = null,
    now = () => Date.now(),
    diagnostic = null,
  } = {}) {
    this.organizationId = assertRealmId(organizationId, REALM_ID_TYPE.ORGANIZATION, 'Organization ID');
    if (typeof resolveMembership !== 'function') throw new TypeError('Capability registry requires resolveMembership');
    if (typeof authorizeIssuer !== 'function') throw new TypeError('Capability registry requires authorizeIssuer');
    this._resolveMembership = resolveMembership;
    this._authorizeIssuer = authorizeIssuer;
    this._authorizeAuditor = authorizeAuditor;
    this._now = now;
    this._diagnostic = typeof diagnostic === 'function' ? diagnostic : null;
    this._grants = new Map();
    this._revocations = new Map();
    this._revocationIds = new Set();
    this._receipts = new Map();
  }

  get(grantId) { return this._grants.get(String(grantId)) ?? null; }
  isRevoked(grantId) { return this._revocations.has(String(grantId)); }
  receipts() { return Object.freeze([...this._receipts.values()]); }

  async acceptGrant(record) {
    return this._observeAsync('capability.grant', record?.grantId, () => this._acceptGrant(record));
  }

  async _acceptGrant(record) {
    if (record.organizationId !== this.organizationId) return { accepted: false, reason: 'wrong-organization' };
    if (this._grants.has(record.grantId)) return { accepted: false, duplicate: true, reason: 'grant-replay' };
    const parent = record.parentGrantId ? this._grants.get(record.parentGrantId) : null;
    const verified = await verifyCapabilityGrant(record, {
      now: this._now(),
      parent,
      resolveParent: grantId => this._grants.get(grantId) ?? null,
    });
    if (!verified.valid) return { accepted: false, reason: verified.reason };
    const issuer = this._resolveMembership(verified.grant.issuerMembershipId);
    if (!issuer?.active || issuer.identityId !== verified.grant.issuerIdentityId
      || issuer.fingerprint !== record.signer.fingerprint) {
      return { accepted: false, reason: 'capability-issuer-key-or-membership-invalid' };
    }
    if (verified.grant.parentGrantId) {
      const parentGrant = this._grants.get(verified.grant.parentGrantId);
      if (!parentGrant || this._chainRevoked(parentGrant)) return { accepted: false, reason: 'capability-parent-inactive' };
      if (!subjectMatches(parentGrant.subject, issuer)) return { accepted: false, reason: 'capability-delegator-not-parent-subject' };
    } else {
      if (verified.grant.recoveryOf) {
        const previous = this._grants.get(verified.grant.recoveryOf);
        if (!previous || !this.isRevoked(previous.grantId)) return { accepted: false, reason: 'capability-recovery-requires-revoked-grant' };
        try { assertNarrower(previous, verified.grant, { recovery: true }); }
        catch (error) { return { accepted: false, reason: error.message }; }
      }
      if (!(await this._authorizeIssuer(issuer, ORGANIZATION_POWER.ADMIN, record))) {
        return { accepted: false, reason: 'capability-root-issuer-unauthorized' };
      }
    }
    this._grants.set(record.grantId, record);
    return { accepted: true, grantId: record.grantId };
  }

  async acceptRevocation(record) {
    return this._observeAsync('capability.revocation', record?.grantId, () => this._acceptRevocation(record));
  }

  async _acceptRevocation(record) {
    if (this._revocationIds.has(record.revocationId)) return { accepted: false, duplicate: true, reason: 'revocation-replay' };
    const verified = await verifyCapabilityRevocation(record);
    if (!verified.valid) return { accepted: false, reason: verified.reason };
    if (verified.revocation.organizationId !== this.organizationId) return { accepted: false, reason: 'wrong-organization' };
    if (!this._grants.has(verified.revocation.grantId)) return { accepted: false, reason: 'unknown-capability' };
    const issuer = this._resolveMembership(verified.revocation.issuerMembershipId);
    if (!issuer?.active || issuer.identityId !== verified.revocation.issuerIdentityId
      || issuer.fingerprint !== record.signer.fingerprint
      || !(await this._authorizeIssuer(issuer, ORGANIZATION_POWER.ADMIN, record))) {
      return { accepted: false, reason: 'revocation-issuer-unauthorized' };
    }
    this._revocations.set(verified.revocation.grantId, record);
    this._revocationIds.add(record.revocationId);
    return { accepted: true, grantId: verified.revocation.grantId };
  }

  authorize(grantId, request) {
    const startedAt = globalThis.performance?.now?.() ?? Date.now();
    const result = this._authorize(grantId, request);
    this._emit('capability.authorization', {
      recordId: String(grantId),
      accepted: result.allowed,
      reason: result.reason,
      elapsedMs: (globalThis.performance?.now?.() ?? Date.now()) - startedAt,
    });
    return result;
  }

  _authorize(grantId, request) {
    const record = this._grants.get(String(grantId));
    if (!record) return { allowed: false, reason: 'unknown-capability' };
    if (this._chainRevoked(record)) return { allowed: false, reason: 'capability-revoked' };
    const now = boundedInteger(request.at ?? this._now(), 'Capability authorization time');
    if (now < record.notBefore) return { allowed: false, reason: 'capability-not-yet-valid' };
    if (now >= record.expiresAt) return { allowed: false, reason: 'capability-expired' };
    const member = request.membershipId ? this._resolveMembership(request.membershipId) : null;
    const context = {
      identityId: request.identityId ?? member?.identityId ?? null,
      membershipId: request.membershipId ?? null,
      roles: member?.active ? member.roles : [],
    };
    if (member && !member.active) return { allowed: false, reason: 'membership-not-active' };
    if (!subjectMatches(record.subject, context)) return { allowed: false, reason: 'capability-subject-mismatch' };
    const normalizedPower = boundedToken(request.power, 'Capability requested power', 32);
    const normalizedRequest = {
      object: request.object ?? null,
      zone: request.zone ?? null,
      action: request.action ?? null,
      branchId: request.branchId ?? null,
      domain: request.domain ?? null,
      power: normalizedPower,
    };
    if (!scopeMatches(record, normalizedRequest)) return { allowed: false, reason: 'capability-scope-mismatch' };
    return { allowed: true, reason: null, grant: record };
  }

  async acceptAuditReceipt(record) {
    return this._observeAsync('capability.audit-receipt', record?.receiptId, () => this._acceptAuditReceipt(record));
  }

  async _acceptAuditReceipt(record) {
    if (this._receipts.has(record.receiptId)) return { accepted: false, duplicate: true, reason: 'receipt-replay' };
    const verified = await verifyCapabilityAuditReceipt(record, {
      authorizeAuditor: this._authorizeAuditor,
    });
    if (!verified.valid) return { accepted: false, reason: verified.reason };
    if (record.organizationId !== this.organizationId || !this._grants.has(record.grantId)) {
      return { accepted: false, reason: 'audit-receipt-scope-invalid' };
    }
    this._receipts.set(record.receiptId, record);
    return { accepted: true, receiptId: record.receiptId };
  }

  _chainRevoked(record) {
    let cursor = record;
    const seen = new Set();
    while (cursor) {
      if (seen.has(cursor.grantId) || this._revocations.has(cursor.grantId)) return true;
      seen.add(cursor.grantId);
      cursor = cursor.parentGrantId ? this._grants.get(cursor.parentGrantId) : null;
    }
    return false;
  }

  async _observeAsync(type, recordId, operation) {
    const startedAt = globalThis.performance?.now?.() ?? Date.now();
    let result;
    try {
      result = await operation();
    } catch (error) {
      result = { accepted: false, reason: error?.message ?? 'capability-operation-failed' };
    }
    this._emit(type, {
      recordId: recordId ?? null,
      accepted: result.accepted,
      reason: result.reason ?? null,
      elapsedMs: (globalThis.performance?.now?.() ?? Date.now()) - startedAt,
    });
    return result;
  }

  _emit(type, detail) {
    if (!this._diagnostic) return;
    try {
      this._diagnostic(Object.freeze({
        type,
        organizationId: this.organizationId,
        at: this._now(),
        ...detail,
      }));
    } catch (_) {
      // Diagnostics are observational and must never alter capability decisions.
    }
  }
}

/** Public contract descriptor for callers that discover schemas dynamically. */
export const CapabilityGrantV1 = Object.freeze({
  format: CAPABILITY_GRANT_V1_FORMAT,
  create: createCapabilityGrant,
  verify: verifyCapabilityGrant,
  attenuate: attenuateCapabilityGrant,
  recover: recoverCapabilityGrant,
  powers: ORGANIZATION_POWER,
});
