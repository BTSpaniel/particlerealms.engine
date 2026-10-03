// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/** Task-bound capability delegation, revocation, and approval proofs. */

import { REALM_ID_TYPE, assertRealmId } from '../addressing/RealmIds.js';
import {
  assertIdentityId,
  assertSecureRecordId,
  authorizeWith,
  boundedText,
  budgetWithin,
  canonicalPublicCopy,
  exactKeys,
  finishSignedAccordRecord,
  normalizeBudget,
  normalizeNonce,
  normalizedBodyMatches,
  normalizeScope,
  normalizeWindow,
  safeInteger,
  scopeWithin,
  validateActiveWindow,
  verifySignedAccordRecord,
} from './AccordCrypto.js';
import { AccordReplayGuard, consumeReplay } from './AccordReplayGuard.js';
import { verifyAccordTask, verifyAccordTaskAcceptance } from './AccordTaskV1.js';

export const ACCORD_DELEGATION_V1_FORMAT = 'realm-accord-delegation-v1';
export const ACCORD_DELEGATION_REVOCATION_V1_FORMAT = 'realm-accord-delegation-revocation-v1';
export const ACCORD_APPROVAL_PROOF_V1_FORMAT = 'realm-accord-approval-proof-v1';

function allowedKeys(input, allowed, name) {
  const unknown = Object.keys(input ?? {}).filter(key => !allowed.includes(key));
  if (unknown.length) throw new TypeError(`${name} contains unsupported fields: ${unknown.sort().join(', ')}`);
}

function normalizeDelegation(input, { signed = false } = {}) {
  const expected = [
    'branchId', 'budget', 'delegatorId', 'expiresAt', 'format', 'grantId',
    'issuedAt', 'maxUses', 'nonce', 'notBefore', 'realmId', 'recipientId',
    'scope', 'taskId',
  ];
  if (signed) expected.push('delegationId', 'signatureHex', 'signer');
  exactKeys(input, expected, 'Accord delegation');
  if (input.format !== ACCORD_DELEGATION_V1_FORMAT) throw new TypeError('Accord delegation format is invalid');
  return Object.freeze({
    format: ACCORD_DELEGATION_V1_FORMAT,
    taskId: assertSecureRecordId(input.taskId, 'delegated task ID'),
    grantId: assertSecureRecordId(input.grantId, 'delegated capability grant ID'),
    delegatorId: assertIdentityId(input.delegatorId, 'delegator ID'),
    recipientId: assertIdentityId(input.recipientId, 'delegation recipient ID'),
    realmId: assertRealmId(input.realmId, REALM_ID_TYPE.REALM, 'delegation Realm ID'),
    branchId: assertRealmId(input.branchId, REALM_ID_TYPE.BRANCH, 'delegation Branch ID'),
    scope: normalizeScope(input.scope, 'delegation scope'),
    budget: normalizeBudget(input.budget, 'delegation budget'),
    maxUses: safeInteger(input.maxUses, 'delegation maxUses', 1, 128),
    ...normalizeWindow(input),
    nonce: normalizeNonce(input.nonce),
  });
}

export async function createAccordDelegation(task, input, signer) {
  allowedKeys(input, ['acceptance', 'budget', 'expiresAt', 'issuedAt', 'maxUses', 'nonce', 'notBefore', 'scope'], 'Accord delegation input');
  const issuedAt = safeInteger(input.issuedAt ?? Date.now(), 'delegation issuedAt');
  const taskCheck = await verifyAccordTask(task, { now: issuedAt });
  if (!taskCheck.valid) throw new Error(`Cannot delegate an invalid Accord task: ${taskCheck.reason}`);
  let ceilingScope = task.scope;
  let ceilingBudget = task.budget;
  let ceilingExpiry = task.expiresAt;
  if (input.acceptance) {
    const accepted = await verifyAccordTaskAcceptance(input.acceptance, { task, now: issuedAt });
    if (!accepted.valid) throw new Error(`Cannot delegate against invalid task acceptance: ${accepted.reason}`);
    ceilingScope = accepted.acceptance.acceptedScope;
    ceilingBudget = accepted.acceptance.acceptedBudget;
    ceilingExpiry = accepted.acceptance.expiresAt;
  }
  const window = normalizeWindow({ issuedAt, notBefore: input.notBefore ?? issuedAt, expiresAt: input.expiresAt ?? ceilingExpiry });
  if (window.expiresAt > ceilingExpiry) throw new RangeError('Accord delegation cannot outlive its task acceptance');
  const normalized = normalizeDelegation({
    format: ACCORD_DELEGATION_V1_FORMAT,
    taskId: task.taskId,
    grantId: task.capabilityGrantId,
    delegatorId: task.requesterId,
    recipientId: task.executorId,
    realmId: task.realmId,
    branchId: task.branchId,
    scope: input.scope ?? ceilingScope,
    budget: input.budget ?? ceilingBudget,
    maxUses: input.maxUses ?? 1,
    ...window,
    nonce: input.nonce,
  });
  if (!scopeWithin(normalized.scope, ceilingScope)) throw new RangeError('Delegation scope exceeds the accepted task scope');
  if (!budgetWithin(normalized.budget, ceilingBudget)) throw new RangeError('Delegation budget exceeds the accepted task budget');
  return finishSignedAccordRecord(normalized, 'delegationId', signer);
}

function grantCoversTask(grant, delegation, task, verification) {
  if (!grant || grant.grantId !== delegation.grantId) return 'capability-grant-mismatch';
  if (grant.notBefore > delegation.notBefore || grant.expiresAt < delegation.expiresAt) return 'capability-grant-window-insufficient';
  if (grant.delegable !== true) return 'capability-grant-not-delegable';
  if (grant.subject?.identityId) {
    if (grant.subject.identityId !== task.requesterId) return 'capability-grant-subject-mismatch';
  } else if (verification?.subjectAuthorized !== true && verification?.authorizedSubjectId !== task.requesterId) {
    return 'capability-grant-subject-unproven';
  }
  const scope = grant.scope;
  if (!scope || !Array.isArray(scope.actions) || !Array.isArray(scope.domains) || !Array.isArray(scope.branches)) return 'capability-grant-scope-malformed';
  if (!scope.domains.includes('*') && !scope.domains.includes(delegation.scope.domain)) return 'capability-grant-domain-insufficient';
  if (!scope.branches.includes('*') && !scope.branches.includes(delegation.branchId)) return 'capability-grant-branch-insufficient';
  if (!scope.actions.includes('*') && delegation.scope.actions.some(action => !scope.actions.includes(action))) return 'capability-grant-action-insufficient';
  const resources = [...(scope.objects ?? []), ...(scope.zones ?? [])];
  if (!resources.includes('*') && delegation.scope.resourceIds.some(resourceId => !resources.includes(resourceId))) return 'capability-grant-resource-insufficient';
  return null;
}

export async function verifyAccordDelegation(record, {
  task,
  acceptance = null,
  capabilityGrant,
  verifyCapabilityGrant,
  now = Date.now(),
  authorizeDelegator = null,
  replayGuard = null,
  isRevoked = null,
  allowExpired = false,
} = {}) {
  const signed = await verifySignedAccordRecord(record, { format: ACCORD_DELEGATION_V1_FORMAT, idField: 'delegationId' });
  if (!signed.valid) return signed;
  try {
    if (!task) return Object.freeze({ valid: false, reason: 'task-required' });
    const taskCheck = await verifyAccordTask(task, { now, allowExpired, replayGuard: null });
    if (!taskCheck.valid) return Object.freeze({ valid: false, reason: `task-${taskCheck.reason}` });
    let acceptedScope = task.scope;
    let acceptedBudget = task.budget;
    let acceptedExpiry = task.expiresAt;
    if (acceptance) {
      const acceptanceCheck = await verifyAccordTaskAcceptance(acceptance, { task, now, allowExpired, replayGuard: null });
      if (!acceptanceCheck.valid) return Object.freeze({ valid: false, reason: `acceptance-${acceptanceCheck.reason}` });
      acceptedScope = acceptanceCheck.acceptance.acceptedScope;
      acceptedBudget = acceptanceCheck.acceptance.acceptedBudget;
      acceptedExpiry = acceptanceCheck.acceptance.expiresAt;
    }
    const delegation = normalizeDelegation(record, { signed: true });
    if (!normalizedBodyMatches(record, delegation)) return Object.freeze({ valid: false, reason: 'non-canonical-record' });
    const bindings = ['taskId', 'grantId', 'realmId', 'branchId'];
    if (bindings.some(field => delegation[field] !== task[field === 'grantId' ? 'capabilityGrantId' : field])) {
      return Object.freeze({ valid: false, reason: 'task-binding-mismatch' });
    }
    if (delegation.delegatorId !== task.requesterId || delegation.recipientId !== task.executorId) {
      return Object.freeze({ valid: false, reason: 'identity-binding-mismatch' });
    }
    if (delegation.expiresAt > acceptedExpiry) return Object.freeze({ valid: false, reason: 'delegation-outlives-acceptance' });
    if (!scopeWithin(delegation.scope, acceptedScope)) return Object.freeze({ valid: false, reason: 'scope-escalation' });
    if (!budgetWithin(delegation.budget, acceptedBudget)) return Object.freeze({ valid: false, reason: 'budget-escalation' });
    if (typeof verifyCapabilityGrant !== 'function') return Object.freeze({ valid: false, reason: 'capability-grant-verifier-required' });
    const grantVerification = await verifyCapabilityGrant(capabilityGrant, {
      now,
      requiredDomain: delegation.scope.domain,
      requiredActions: delegation.scope.actions,
      requiredBranchId: delegation.branchId,
      requiredResourceIds: delegation.scope.resourceIds,
      expectedSubjectId: task.requesterId,
    });
    if (!(grantVerification === true || grantVerification?.valid === true)) {
      return Object.freeze({ valid: false, reason: grantVerification?.reason ?? 'capability-grant-invalid' });
    }
    const coverageFailure = grantCoversTask(capabilityGrant, delegation, task, grantVerification);
    if (coverageFailure) return Object.freeze({ valid: false, reason: coverageFailure });
    if (typeof isRevoked === 'function' && await isRevoked(delegation.delegationId, delegation)) {
      return Object.freeze({ valid: false, reason: 'delegation-revoked' });
    }
    const active = validateActiveWindow(delegation, now, { allowExpired });
    if (!active.valid) return active;
    const authorized = await authorizeWith(authorizeDelegator, record, 'delegator');
    if (!authorized.valid) return authorized;
    const replay = consumeReplay(replayGuard, record, { idField: 'delegationId' });
    if (!replay.valid) return replay;
    return Object.freeze({ ...signed, delegation });
  } catch (error) {
    return Object.freeze({ valid: false, reason: error?.message ?? 'delegation-invalid' });
  }
}

function normalizeRevocation(input, { signed = false } = {}) {
  const expected = ['delegationId', 'expiresAt', 'format', 'issuedAt', 'nonce', 'notBefore', 'reason', 'revokerId', 'taskId'];
  if (signed) expected.push('revocationId', 'signatureHex', 'signer');
  exactKeys(input, expected, 'Accord delegation revocation');
  if (input.format !== ACCORD_DELEGATION_REVOCATION_V1_FORMAT) throw new TypeError('Accord delegation revocation format is invalid');
  return Object.freeze({
    format: ACCORD_DELEGATION_REVOCATION_V1_FORMAT,
    taskId: assertSecureRecordId(input.taskId, 'revoked task ID'),
    delegationId: assertSecureRecordId(input.delegationId, 'revoked delegation ID'),
    revokerId: assertIdentityId(input.revokerId, 'delegation revoker ID'),
    reason: boundedText(input.reason, 'delegation revocation reason', 512),
    ...normalizeWindow(input),
    nonce: normalizeNonce(input.nonce),
  });
}

export async function createAccordDelegationRevocation(delegation, input, signer) {
  allowedKeys(input, ['issuedAt', 'nonce', 'reason'], 'Accord delegation revocation input');
  const issuedAt = safeInteger(input.issuedAt ?? Date.now(), 'delegation revocation issuedAt');
  if (issuedAt >= delegation.expiresAt) throw new RangeError('An expired Accord delegation does not require revocation');
  const normalized = normalizeRevocation({
    format: ACCORD_DELEGATION_REVOCATION_V1_FORMAT,
    taskId: delegation.taskId,
    delegationId: delegation.delegationId,
    revokerId: delegation.delegatorId,
    reason: input.reason,
    issuedAt,
    notBefore: issuedAt,
    expiresAt: delegation.expiresAt,
    nonce: input.nonce,
  });
  return finishSignedAccordRecord(normalized, 'revocationId', signer);
}

export async function verifyAccordDelegationRevocation(record, {
  delegation,
  now = Date.now(),
  authorizeDelegator = null,
  replayGuard = null,
} = {}) {
  const signed = await verifySignedAccordRecord(record, { format: ACCORD_DELEGATION_REVOCATION_V1_FORMAT, idField: 'revocationId' });
  if (!signed.valid) return signed;
  try {
    if (!delegation) return Object.freeze({ valid: false, reason: 'delegation-required' });
    const revocation = normalizeRevocation(record, { signed: true });
    if (!normalizedBodyMatches(record, revocation)) return Object.freeze({ valid: false, reason: 'non-canonical-record' });
    if (revocation.taskId !== delegation.taskId || revocation.delegationId !== delegation.delegationId
      || revocation.revokerId !== delegation.delegatorId) {
      return Object.freeze({ valid: false, reason: 'delegation-binding-mismatch' });
    }
    if (revocation.issuedAt >= delegation.expiresAt || revocation.expiresAt !== delegation.expiresAt) {
      return Object.freeze({ valid: false, reason: 'revocation-window-invalid' });
    }
    if (now < revocation.notBefore) return Object.freeze({ valid: false, reason: 'not-yet-valid' });
    const authorized = await authorizeWith(authorizeDelegator, record, 'delegation-revoker');
    if (!authorized.valid) return authorized;
    const replay = consumeReplay(replayGuard, record, { idField: 'revocationId' });
    if (!replay.valid) return replay;
    return Object.freeze({ ...signed, revocation });
  } catch (error) {
    return Object.freeze({ valid: false, reason: error?.message ?? 'delegation-revocation-invalid' });
  }
}

function normalizeApproval(input, { signed = false } = {}) {
  const expected = [
    'approverId', 'constraints', 'decision', 'expiresAt', 'format', 'issuedAt',
    'nonce', 'notBefore', 'scope', 'taskId',
  ];
  if (signed) expected.push('approvalProofId', 'signatureHex', 'signer');
  exactKeys(input, expected, 'Accord approval proof');
  if (input.format !== ACCORD_APPROVAL_PROOF_V1_FORMAT) throw new TypeError('Accord approval proof format is invalid');
  const decision = String(input.decision ?? '').trim().toLowerCase();
  if (!['approved', 'denied'].includes(decision)) throw new TypeError('Accord approval decision must be approved or denied');
  return Object.freeze({
    format: ACCORD_APPROVAL_PROOF_V1_FORMAT,
    taskId: assertSecureRecordId(input.taskId, 'approval task ID'),
    approverId: assertIdentityId(input.approverId, 'approver ID'),
    decision,
    scope: normalizeScope(input.scope, 'approved scope'),
    constraints: canonicalPublicCopy(input.constraints, 'approval constraints', { maximumBytes: 32 * 1024 }),
    ...normalizeWindow(input),
    nonce: normalizeNonce(input.nonce),
  });
}

export async function createAccordApprovalProof(task, input, signer) {
  allowedKeys(input, ['approverId', 'constraints', 'decision', 'expiresAt', 'issuedAt', 'nonce', 'notBefore', 'scope'], 'Accord approval input');
  const issuedAt = safeInteger(input.issuedAt ?? Date.now(), 'approval issuedAt');
  const taskCheck = await verifyAccordTask(task, { now: issuedAt });
  if (!taskCheck.valid) throw new Error(`Cannot approve invalid Accord task: ${taskCheck.reason}`);
  if (!task.approvalPolicy.required) throw new Error('Accord task does not require approval');
  if (!task.approvalPolicy.approverIds.includes(input.approverId)) throw new Error('Accord approver is not named by the task policy');
  const window = normalizeWindow({ issuedAt, notBefore: input.notBefore ?? issuedAt, expiresAt: input.expiresAt ?? task.expiresAt });
  if (window.expiresAt > task.expiresAt) throw new RangeError('Accord approval cannot outlive its task');
  const normalized = normalizeApproval({
    format: ACCORD_APPROVAL_PROOF_V1_FORMAT,
    taskId: task.taskId,
    approverId: input.approverId,
    decision: input.decision,
    scope: input.scope ?? task.scope,
    constraints: input.constraints ?? {},
    ...window,
    nonce: input.nonce,
  });
  if (!scopeWithin(normalized.scope, task.scope)) throw new RangeError('Accord approval scope exceeds the task scope');
  return finishSignedAccordRecord(normalized, 'approvalProofId', signer);
}

export async function verifyAccordApprovalProof(record, {
  task,
  now = Date.now(),
  authorizeApprover = null,
  replayGuard = null,
  allowExpired = false,
} = {}) {
  const signed = await verifySignedAccordRecord(record, { format: ACCORD_APPROVAL_PROOF_V1_FORMAT, idField: 'approvalProofId' });
  if (!signed.valid) return signed;
  try {
    if (!task) return Object.freeze({ valid: false, reason: 'task-required' });
    const taskCheck = await verifyAccordTask(task, { now, allowExpired, replayGuard: null });
    if (!taskCheck.valid) return Object.freeze({ valid: false, reason: `task-${taskCheck.reason}` });
    const approval = normalizeApproval(record, { signed: true });
    if (!normalizedBodyMatches(record, approval)) return Object.freeze({ valid: false, reason: 'non-canonical-record' });
    if (approval.taskId !== task.taskId || !task.approvalPolicy.approverIds.includes(approval.approverId)) {
      return Object.freeze({ valid: false, reason: 'approval-policy-mismatch' });
    }
    if (approval.expiresAt > task.expiresAt) return Object.freeze({ valid: false, reason: 'approval-outlives-task' });
    if (!scopeWithin(approval.scope, task.scope)) return Object.freeze({ valid: false, reason: 'scope-escalation' });
    const active = validateActiveWindow(approval, now, { allowExpired });
    if (!active.valid) return active;
    const authorized = await authorizeWith(authorizeApprover, record, 'approver');
    if (!authorized.valid) return authorized;
    const replay = consumeReplay(replayGuard, record, { idField: 'approvalProofId' });
    if (!replay.valid) return replay;
    return Object.freeze({ ...signed, approval });
  } catch (error) {
    return Object.freeze({ valid: false, reason: error?.message ?? 'approval-proof-invalid' });
  }
}

export class AccordDelegationRegistry {
  constructor({ now = () => Date.now(), onDiagnostic = null } = {}) {
    this._now = now;
    this._onDiagnostic = typeof onDiagnostic === 'function' ? onDiagnostic : null;
    this._delegations = new Map();
    this._revocations = new Map();
    this._uses = new Map();
    this.replayGuard = new AccordReplayGuard({ now, onDiagnostic });
  }

  _emit(type, details) {
    try { this._onDiagnostic?.(Object.freeze({ type, at: this._now(), ...details })); } catch (_) { /* diagnostics are isolated */ }
  }

  async accept(record, options) {
    const verified = await verifyAccordDelegation(record, { ...options, now: this._now(), replayGuard: this.replayGuard, isRevoked: id => this.isRevoked(id) });
    if (!verified.valid) return Object.freeze({ accepted: false, reason: verified.reason });
    this._delegations.set(record.delegationId, record);
    this._uses.set(record.delegationId, 0);
    this._emit('delegation-accepted', { delegationId: record.delegationId, taskId: record.taskId });
    return Object.freeze({ accepted: true, delegation: verified.delegation });
  }

  async revoke(record, options = {}) {
    const delegation = this._delegations.get(record.delegationId);
    if (!delegation) return Object.freeze({ revoked: false, reason: 'delegation-unknown' });
    const verified = await verifyAccordDelegationRevocation(record, {
      ...options,
      delegation,
      now: this._now(),
      replayGuard: this.replayGuard,
    });
    if (!verified.valid) return Object.freeze({ revoked: false, reason: verified.reason });
    this._revocations.set(record.delegationId, record);
    this._emit('delegation-revoked', { delegationId: record.delegationId, revocationId: record.revocationId });
    return Object.freeze({ revoked: true, revocation: verified.revocation });
  }

  isRevoked(delegationId) {
    return this._revocations.has(String(delegationId));
  }

  authorize({ delegationId, taskId, recipientId, action, resourceId = null, budget, consume = false }) {
    const delegation = this._delegations.get(String(delegationId));
    if (!delegation) return Object.freeze({ allowed: false, reason: 'delegation-unknown' });
    if (this.isRevoked(delegationId)) return Object.freeze({ allowed: false, reason: 'delegation-revoked' });
    const now = safeInteger(this._now(), 'authorization time');
    if (now < delegation.notBefore || now >= delegation.expiresAt) return Object.freeze({ allowed: false, reason: 'delegation-inactive' });
    if (delegation.taskId !== taskId || delegation.recipientId !== recipientId) return Object.freeze({ allowed: false, reason: 'delegation-binding-mismatch' });
    if (!delegation.scope.actions.includes(String(action))) return Object.freeze({ allowed: false, reason: 'action-not-delegated' });
    if (resourceId !== null && !delegation.scope.resourceIds.includes(String(resourceId))) return Object.freeze({ allowed: false, reason: 'resource-not-delegated' });
    if (budget && !budgetWithin(budget, delegation.budget)) return Object.freeze({ allowed: false, reason: 'budget-exceeded' });
    const uses = this._uses.get(delegation.delegationId) ?? 0;
    if (uses >= delegation.maxUses) return Object.freeze({ allowed: false, reason: 'delegation-use-limit' });
    if (consume) this._uses.set(delegation.delegationId, uses + 1);
    return Object.freeze({ allowed: true, uses: consume ? uses + 1 : uses, remainingUses: delegation.maxUses - (consume ? uses + 1 : uses) });
  }
}
