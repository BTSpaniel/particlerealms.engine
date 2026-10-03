// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/** Requester-signed Accord tasks and executor-signed negotiated acceptance. */

import { REALM_ID_TYPE, assertRealmId } from '../addressing/RealmIds.js';
import { ACCORD_CONTEXT_KINDS } from './AccordCapabilityV1.js';
import {
  assertIdentityId,
  assertSecureRecordId,
  authorizeWith,
  boundedToken,
  budgetWithin,
  canonicalPublicCopy,
  exactKeys,
  finishSignedAccordRecord,
  normalizeBudget,
  normalizeIdList,
  normalizeNonce,
  normalizedBodyMatches,
  normalizeScope,
  normalizeTokenList,
  normalizeWindow,
  safeInteger,
  scopeWithin,
  validateActiveWindow,
  verifySignedAccordRecord,
} from './AccordCrypto.js';
import { consumeReplay } from './AccordReplayGuard.js';

export const ACCORD_TASK_V1_FORMAT = 'realm-accord-task-v1';
export const ACCORD_TASK_ACCEPTANCE_V1_FORMAT = 'realm-accord-task-acceptance-v1';

const CONTEXT_KIND_SET = new Set(ACCORD_CONTEXT_KINDS);

function allowedKeys(input, allowed, name) {
  const unknown = Object.keys(input ?? {}).filter(key => !allowed.includes(key));
  if (unknown.length) throw new TypeError(`${name} contains unsupported fields: ${unknown.sort().join(', ')}`);
}

function normalizeVersion(value, name) {
  const version = String(value ?? '').trim();
  if (!/^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?$/.test(version)) {
    throw new TypeError(`${name} must be a semantic version`);
  }
  return version;
}

function normalizeCapability(value) {
  exactKeys(value, ['advertisementId', 'name', 'version'], 'task capability');
  return Object.freeze({
    advertisementId: assertSecureRecordId(value.advertisementId, 'task capability advertisement ID'),
    name: boundedToken(value.name, 'task capability name', 96),
    version: normalizeVersion(value.version, 'task capability version'),
  });
}

function normalizeRequest(value) {
  exactKeys(value, ['operation', 'parameters'], 'task request');
  return Object.freeze({
    operation: boundedToken(value.operation, 'task operation', 96),
    parameters: canonicalPublicCopy(value.parameters, 'task parameters', { maximumBytes: 64 * 1024 }),
  });
}

function normalizeContextPolicy(value) {
  exactKeys(value, ['allowedKinds', 'maxBytes', 'maxCapsules'], 'task context policy');
  const allowedKinds = normalizeTokenList(value.allowedKinds, 'task context allowedKinds', { maximum: CONTEXT_KIND_SET.size });
  for (const kind of allowedKinds) {
    if (!CONTEXT_KIND_SET.has(kind)) throw new TypeError(`Unsupported task context kind: ${kind}`);
  }
  return Object.freeze({
    allowedKinds,
    maxCapsules: safeInteger(value.maxCapsules, 'task context maxCapsules', 1, 64),
    maxBytes: safeInteger(value.maxBytes, 'task context maxBytes', 1, 4 * 1024 * 1024),
  });
}

function normalizeApprovalPolicy(value) {
  exactKeys(value, ['approverIds', 'minimumApprovals', 'required'], 'task approval policy');
  const required = value.required === true;
  const approverIds = normalizeIdList(value.approverIds, 'task approverIds', { maximum: 64, allowEmpty: !required });
  approverIds.forEach((identityId, index) => assertIdentityId(identityId, `task approverIds[${index}]`));
  const minimumApprovals = safeInteger(value.minimumApprovals, 'task minimumApprovals', required ? 1 : 0, 64);
  if (minimumApprovals > approverIds.length) throw new RangeError('Task minimum approvals exceeds its approver list');
  if (!required && (approverIds.length !== 0 || minimumApprovals !== 0)) {
    throw new RangeError('A task without required approval must not name approvers');
  }
  return Object.freeze({ required, approverIds, minimumApprovals });
}

function normalizeTask(input, { signed = false } = {}) {
  const expected = [
    'approvalPolicy', 'branchId', 'budget', 'capability', 'capabilityGrantId',
    'contextPolicy', 'executorId', 'expiresAt', 'format', 'issuedAt', 'nonce',
    'notBefore', 'realmId', 'request', 'requesterId', 'scope',
  ];
  if (signed) expected.push('signatureHex', 'signer', 'taskId');
  exactKeys(input, expected, 'Accord task');
  if (input.format !== ACCORD_TASK_V1_FORMAT) throw new TypeError('Accord task format is invalid');
  return Object.freeze({
    format: ACCORD_TASK_V1_FORMAT,
    requesterId: assertIdentityId(input.requesterId, 'task requester ID'),
    executorId: assertIdentityId(input.executorId, 'task executor ID'),
    realmId: assertRealmId(input.realmId, REALM_ID_TYPE.REALM, 'task Realm ID'),
    branchId: assertRealmId(input.branchId, REALM_ID_TYPE.BRANCH, 'task Branch ID'),
    capability: normalizeCapability(input.capability),
    capabilityGrantId: assertSecureRecordId(input.capabilityGrantId, 'task capability grant ID'),
    request: normalizeRequest(input.request),
    scope: normalizeScope(input.scope, 'task scope'),
    budget: normalizeBudget(input.budget, 'task budget'),
    contextPolicy: normalizeContextPolicy(input.contextPolicy),
    approvalPolicy: normalizeApprovalPolicy(input.approvalPolicy),
    ...normalizeWindow(input),
    nonce: normalizeNonce(input.nonce),
  });
}

export async function createAccordTask(input, signer) {
  const allowed = [
    'approvalPolicy', 'branchId', 'budget', 'capability', 'capabilityGrantId',
    'contextPolicy', 'executorId', 'expiresAt', 'issuedAt', 'nonce', 'notBefore',
    'realmId', 'request', 'requesterId', 'scope',
  ];
  allowedKeys(input, allowed, 'Accord task input');
  const window = normalizeWindow(input);
  const normalized = normalizeTask({
    format: ACCORD_TASK_V1_FORMAT,
    requesterId: input.requesterId,
    executorId: input.executorId,
    realmId: input.realmId,
    branchId: input.branchId,
    capability: input.capability,
    capabilityGrantId: input.capabilityGrantId,
    request: input.request,
    scope: input.scope,
    budget: input.budget,
    contextPolicy: input.contextPolicy,
    approvalPolicy: input.approvalPolicy ?? { required: false, approverIds: [], minimumApprovals: 0 },
    ...window,
    nonce: input.nonce,
  });
  return finishSignedAccordRecord(normalized, 'taskId', signer);
}

export async function verifyAccordTask(record, {
  now = Date.now(),
  expectedRequesterId = null,
  expectedExecutorId = null,
  authorizeRequester = null,
  replayGuard = null,
  allowExpired = false,
} = {}) {
  const signed = await verifySignedAccordRecord(record, { format: ACCORD_TASK_V1_FORMAT, idField: 'taskId' });
  if (!signed.valid) return signed;
  try {
    const task = normalizeTask(record, { signed: true });
    if (!normalizedBodyMatches(record, task)) return Object.freeze({ valid: false, reason: 'non-canonical-record' });
    if (expectedRequesterId !== null && task.requesterId !== expectedRequesterId) return Object.freeze({ valid: false, reason: 'requester-mismatch' });
    if (expectedExecutorId !== null && task.executorId !== expectedExecutorId) return Object.freeze({ valid: false, reason: 'executor-mismatch' });
    const active = validateActiveWindow(task, now, { allowExpired });
    if (!active.valid) return active;
    const authorized = await authorizeWith(authorizeRequester, record, 'requester');
    if (!authorized.valid) return authorized;
    const replay = consumeReplay(replayGuard, record, { idField: 'taskId' });
    if (!replay.valid) return replay;
    return Object.freeze({ ...signed, task });
  } catch (error) {
    return Object.freeze({ valid: false, reason: error?.message ?? 'task-invalid' });
  }
}

function normalizeAcceptance(input, { signed = false } = {}) {
  const expected = [
    'acceptedBudget', 'acceptedContextKinds', 'acceptedScope', 'branchId',
    'executorId', 'expiresAt', 'format', 'issuedAt', 'nonce', 'notBefore',
    'realmId', 'requesterId', 'taskId',
  ];
  if (signed) expected.push('acceptanceId', 'signatureHex', 'signer');
  exactKeys(input, expected, 'Accord task acceptance');
  if (input.format !== ACCORD_TASK_ACCEPTANCE_V1_FORMAT) throw new TypeError('Accord task acceptance format is invalid');
  const acceptedContextKinds = normalizeTokenList(input.acceptedContextKinds, 'accepted context kinds', { maximum: CONTEXT_KIND_SET.size });
  for (const kind of acceptedContextKinds) {
    if (!CONTEXT_KIND_SET.has(kind)) throw new TypeError(`Unsupported accepted context kind: ${kind}`);
  }
  return Object.freeze({
    format: ACCORD_TASK_ACCEPTANCE_V1_FORMAT,
    taskId: assertSecureRecordId(input.taskId, 'accepted task ID'),
    requesterId: assertIdentityId(input.requesterId, 'accepted requester ID'),
    executorId: assertIdentityId(input.executorId, 'accepting executor ID'),
    realmId: assertRealmId(input.realmId, REALM_ID_TYPE.REALM, 'accepted Realm ID'),
    branchId: assertRealmId(input.branchId, REALM_ID_TYPE.BRANCH, 'accepted Branch ID'),
    acceptedScope: normalizeScope(input.acceptedScope, 'accepted scope'),
    acceptedBudget: normalizeBudget(input.acceptedBudget, 'accepted budget'),
    acceptedContextKinds,
    ...normalizeWindow(input),
    nonce: normalizeNonce(input.nonce),
  });
}

export async function createAccordTaskAcceptance(task, input, signer) {
  const checked = await verifyAccordTask(task, { now: input.issuedAt ?? Date.now(), allowExpired: false });
  if (!checked.valid) throw new Error(`Cannot accept invalid Accord task: ${checked.reason}`);
  allowedKeys(input, ['acceptedBudget', 'acceptedContextKinds', 'acceptedScope', 'expiresAt', 'issuedAt', 'nonce', 'notBefore'], 'Accord acceptance input');
  const issuedAt = safeInteger(input.issuedAt ?? Date.now(), 'acceptance issuedAt');
  const window = normalizeWindow({
    issuedAt,
    notBefore: input.notBefore ?? issuedAt,
    expiresAt: input.expiresAt ?? task.expiresAt,
  });
  if (window.expiresAt > task.expiresAt) throw new RangeError('Accord acceptance cannot outlive its task');
  const normalized = normalizeAcceptance({
    format: ACCORD_TASK_ACCEPTANCE_V1_FORMAT,
    taskId: task.taskId,
    requesterId: task.requesterId,
    executorId: task.executorId,
    realmId: task.realmId,
    branchId: task.branchId,
    acceptedScope: input.acceptedScope ?? task.scope,
    acceptedBudget: input.acceptedBudget ?? task.budget,
    acceptedContextKinds: input.acceptedContextKinds ?? task.contextPolicy.allowedKinds,
    ...window,
    nonce: input.nonce,
  });
  if (!scopeWithin(normalized.acceptedScope, task.scope)) throw new RangeError('Accepted scope exceeds the requested task scope');
  if (!budgetWithin(normalized.acceptedBudget, task.budget)) throw new RangeError('Accepted budget exceeds the requested task budget');
  if (normalized.acceptedContextKinds.some(kind => !task.contextPolicy.allowedKinds.includes(kind))) {
    throw new RangeError('Accepted context kinds exceed the task policy');
  }
  return finishSignedAccordRecord(normalized, 'acceptanceId', signer);
}

export async function verifyAccordTaskAcceptance(record, {
  task,
  now = Date.now(),
  authorizeExecutor = null,
  replayGuard = null,
  allowExpired = false,
} = {}) {
  const signed = await verifySignedAccordRecord(record, { format: ACCORD_TASK_ACCEPTANCE_V1_FORMAT, idField: 'acceptanceId' });
  if (!signed.valid) return signed;
  try {
    if (!task) return Object.freeze({ valid: false, reason: 'task-required' });
    const taskCheck = await verifyAccordTask(task, { now, allowExpired, replayGuard: null });
    if (!taskCheck.valid) return Object.freeze({ valid: false, reason: `task-${taskCheck.reason}` });
    const acceptance = normalizeAcceptance(record, { signed: true });
    if (!normalizedBodyMatches(record, acceptance)) return Object.freeze({ valid: false, reason: 'non-canonical-record' });
    const bindings = ['taskId', 'requesterId', 'executorId', 'realmId', 'branchId'];
    if (bindings.some(field => acceptance[field] !== task[field])) return Object.freeze({ valid: false, reason: 'task-binding-mismatch' });
    if (acceptance.expiresAt > task.expiresAt) return Object.freeze({ valid: false, reason: 'acceptance-outlives-task' });
    if (!scopeWithin(acceptance.acceptedScope, task.scope)) return Object.freeze({ valid: false, reason: 'scope-escalation' });
    if (!budgetWithin(acceptance.acceptedBudget, task.budget)) return Object.freeze({ valid: false, reason: 'budget-escalation' });
    if (acceptance.acceptedContextKinds.some(kind => !task.contextPolicy.allowedKinds.includes(kind))) {
      return Object.freeze({ valid: false, reason: 'context-policy-escalation' });
    }
    const active = validateActiveWindow(acceptance, now, { allowExpired });
    if (!active.valid) return active;
    const authorized = await authorizeWith(authorizeExecutor, record, 'executor');
    if (!authorized.valid) return authorized;
    const replay = consumeReplay(replayGuard, record, { idField: 'acceptanceId' });
    if (!replay.valid) return replay;
    return Object.freeze({ ...signed, acceptance });
  } catch (error) {
    return Object.freeze({ valid: false, reason: error?.message ?? 'task-acceptance-invalid' });
  }
}

export const AccordTaskV1 = Object.freeze({
  format: ACCORD_TASK_V1_FORMAT,
  create: createAccordTask,
  verify: verifyAccordTask,
  createAcceptance: createAccordTaskAcceptance,
  verifyAcceptance: verifyAccordTaskAcceptance,
});
