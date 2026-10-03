// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/** Signed Accord progress, cancellation, results, and purpose-isolated reputation evidence. */

import { canonicalize } from '../../../state/util/canonical.js';
import { REALM_ID_TYPE, assertRealmId, isRealmId } from '../addressing/RealmIds.js';
import {
  assertIdentityId,
  assertSecureRecordId,
  authorizeWith,
  boundedText,
  boundedToken,
  budgetWithin,
  exactKeys,
  finishSignedAccordRecord,
  normalizeBudget,
  normalizeNonce,
  normalizedBodyMatches,
  normalizeScope,
  normalizeWindow,
  safeInteger,
  validateActiveWindow,
  verifySignedAccordRecord,
} from './AccordCrypto.js';
import { consumeReplay } from './AccordReplayGuard.js';
import { verifyAccordTask, verifyAccordTaskAcceptance } from './AccordTaskV1.js';
import { verifyContextCapsuleV1 } from './ContextCapsuleV1.js';
import {
  verifyAccordApprovalProof,
  verifyAccordDelegation,
} from './AccordDelegationV1.js';

export const ACCORD_PROGRESS_V1_FORMAT = 'realm-accord-progress-v1';
export const ACCORD_CANCELLATION_V1_FORMAT = 'realm-accord-cancellation-v1';
export const ACCORD_RESULT_V1_FORMAT = 'realm-accord-result-v1';
export const ACCORD_REPUTATION_EVIDENCE_V1_FORMAT = 'realm-accord-reputation-evidence-v1';

const PROGRESS_STATES = new Set(['accepted', 'awaiting-approval', 'running', 'finalizing']);
const RESULT_STATES = new Set(['cancelled', 'completed', 'failed']);
const OUTPUT_KINDS = new Set(['asset-ref', 'capsule-ref', 'chronicle-ref', 'record-ref']);
const REPUTATION_OUTCOMES = new Set(['cancelled', 'disputed', 'failure', 'success']);

function allowedKeys(input, allowed, name) {
  const unknown = Object.keys(input ?? {}).filter(key => !allowed.includes(key));
  if (unknown.length) throw new TypeError(`${name} contains unsupported fields: ${unknown.sort().join(', ')}`);
}

function normalizeReference(value, name) {
  const reference = String(value ?? '').trim().toLowerCase();
  if (/^sha256:256:[0-9a-f]{64}$/.test(reference) || isRealmId(reference)) return reference;
  throw new TypeError(`${name} must be an immutable Realm or SHA-256 record reference`);
}

function normalizeProgress(input, { signed = false } = {}) {
  const expected = [
    'acceptanceId', 'branchId', 'checkpointRefs', 'executorId', 'expiresAt',
    'format', 'issuedAt', 'message', 'nonce', 'notBefore', 'percentBasisPoints',
    'realmId', 'requesterId', 'sequence', 'state', 'taskId', 'usage',
  ];
  if (signed) expected.push('progressId', 'signatureHex', 'signer');
  exactKeys(input, expected, 'Accord progress');
  if (input.format !== ACCORD_PROGRESS_V1_FORMAT) throw new TypeError('Accord progress format is invalid');
  const state = String(input.state ?? '').trim().toLowerCase();
  if (!PROGRESS_STATES.has(state)) throw new TypeError('Accord progress state is invalid');
  if (!Array.isArray(input.checkpointRefs) || input.checkpointRefs.length > 64) throw new TypeError('Accord progress checkpointRefs must be a bounded array');
  const checkpointRefs = input.checkpointRefs.map((value, index) => normalizeReference(value, `checkpointRefs[${index}]`)).sort();
  if (new Set(checkpointRefs).size !== checkpointRefs.length) throw new TypeError('Accord progress checkpointRefs must be unique');
  return Object.freeze({
    format: ACCORD_PROGRESS_V1_FORMAT,
    taskId: assertSecureRecordId(input.taskId, 'progress task ID'),
    acceptanceId: assertSecureRecordId(input.acceptanceId, 'progress acceptance ID'),
    requesterId: assertIdentityId(input.requesterId, 'progress requester ID'),
    executorId: assertIdentityId(input.executorId, 'progress executor ID'),
    realmId: assertRealmId(input.realmId, REALM_ID_TYPE.REALM, 'progress Realm ID'),
    branchId: assertRealmId(input.branchId, REALM_ID_TYPE.BRANCH, 'progress Branch ID'),
    sequence: safeInteger(input.sequence, 'progress sequence', 1),
    state,
    percentBasisPoints: safeInteger(input.percentBasisPoints, 'progress percentBasisPoints', 0, 10_000),
    usage: normalizeBudget(input.usage, 'progress usage', { allowZero: true }),
    checkpointRefs: Object.freeze(checkpointRefs),
    message: boundedText(input.message, 'progress message', 512),
    ...normalizeWindow(input),
    nonce: normalizeNonce(input.nonce),
  });
}

export async function createAccordProgress(task, acceptance, input, signer) {
  allowedKeys(input, ['checkpointRefs', 'expiresAt', 'issuedAt', 'message', 'nonce', 'percentBasisPoints', 'sequence', 'state', 'usage'], 'Accord progress input');
  const issuedAt = safeInteger(input.issuedAt ?? Date.now(), 'progress issuedAt');
  const accepted = await verifyAccordTaskAcceptance(acceptance, { task, now: issuedAt });
  if (!accepted.valid) throw new Error(`Cannot report progress for invalid acceptance: ${accepted.reason}`);
  const window = normalizeWindow({ issuedAt, notBefore: issuedAt, expiresAt: input.expiresAt ?? acceptance.expiresAt });
  if (window.expiresAt > acceptance.expiresAt) throw new RangeError('Accord progress cannot outlive task acceptance');
  const normalized = normalizeProgress({
    format: ACCORD_PROGRESS_V1_FORMAT,
    taskId: task.taskId,
    acceptanceId: acceptance.acceptanceId,
    requesterId: task.requesterId,
    executorId: task.executorId,
    realmId: task.realmId,
    branchId: task.branchId,
    sequence: input.sequence,
    state: input.state,
    percentBasisPoints: input.percentBasisPoints,
    usage: input.usage ?? {},
    checkpointRefs: input.checkpointRefs ?? [],
    message: input.message,
    ...window,
    nonce: input.nonce,
  });
  if (!budgetWithin(normalized.usage, acceptance.acceptedBudget)) throw new RangeError('Accord progress usage exceeds accepted budget');
  return finishSignedAccordRecord(normalized, 'progressId', signer);
}

export async function verifyAccordProgress(record, {
  task,
  acceptance,
  now = Date.now(),
  authorizeExecutor = null,
  replayGuard = null,
  allowExpired = false,
} = {}) {
  const signed = await verifySignedAccordRecord(record, { format: ACCORD_PROGRESS_V1_FORMAT, idField: 'progressId' });
  if (!signed.valid) return signed;
  try {
    const accepted = await verifyAccordTaskAcceptance(acceptance, { task, now, allowExpired, replayGuard: null });
    if (!accepted.valid) return Object.freeze({ valid: false, reason: `acceptance-${accepted.reason}` });
    const progress = normalizeProgress(record, { signed: true });
    if (!normalizedBodyMatches(record, progress)) return Object.freeze({ valid: false, reason: 'non-canonical-record' });
    const bindings = ['taskId', 'acceptanceId', 'requesterId', 'executorId', 'realmId', 'branchId'];
    const source = { ...task, acceptanceId: acceptance.acceptanceId };
    if (bindings.some(field => progress[field] !== source[field])) return Object.freeze({ valid: false, reason: 'acceptance-binding-mismatch' });
    if (progress.expiresAt > acceptance.expiresAt) return Object.freeze({ valid: false, reason: 'progress-outlives-acceptance' });
    if (!budgetWithin(progress.usage, acceptance.acceptedBudget)) return Object.freeze({ valid: false, reason: 'budget-exceeded' });
    const active = validateActiveWindow(progress, now, { allowExpired });
    if (!active.valid) return active;
    const authorized = await authorizeWith(authorizeExecutor, record, 'progress-executor');
    if (!authorized.valid) return authorized;
    const replay = consumeReplay(replayGuard, record, {
      idField: 'progressId',
      streamKey: `${record.taskId}:${record.executorId}:progress`,
      sequence: record.sequence,
    });
    if (!replay.valid) return replay;
    return Object.freeze({ ...signed, progress });
  } catch (error) {
    return Object.freeze({ valid: false, reason: error?.message ?? 'progress-invalid' });
  }
}

function normalizeCancellation(input, { signed = false } = {}) {
  const expected = [
    'cancelledById', 'effectiveAt', 'executorId', 'expiresAt', 'format',
    'issuedAt', 'nonce', 'notBefore', 'reason', 'requesterId', 'taskId',
  ];
  if (signed) expected.push('cancellationId', 'signatureHex', 'signer');
  exactKeys(input, expected, 'Accord cancellation');
  if (input.format !== ACCORD_CANCELLATION_V1_FORMAT) throw new TypeError('Accord cancellation format is invalid');
  const requesterId = assertIdentityId(input.requesterId, 'cancellation requester ID');
  const executorId = assertIdentityId(input.executorId, 'cancellation executor ID');
  const cancelledById = assertIdentityId(input.cancelledById, 'cancelling identity ID');
  if (cancelledById !== requesterId && cancelledById !== executorId) throw new TypeError('Accord cancellation must be issued by its requester or executor');
  const window = normalizeWindow(input);
  const effectiveAt = safeInteger(input.effectiveAt, 'cancellation effectiveAt', window.issuedAt);
  if (effectiveAt >= window.expiresAt) throw new RangeError('Accord cancellation takes effect after its expiry');
  return Object.freeze({
    format: ACCORD_CANCELLATION_V1_FORMAT,
    taskId: assertSecureRecordId(input.taskId, 'cancelled task ID'),
    requesterId,
    executorId,
    cancelledById,
    reason: boundedText(input.reason, 'cancellation reason', 512),
    effectiveAt,
    ...window,
    nonce: normalizeNonce(input.nonce),
  });
}

export async function createAccordCancellation(task, input, signer) {
  allowedKeys(input, ['cancelledById', 'effectiveAt', 'issuedAt', 'nonce', 'reason'], 'Accord cancellation input');
  const issuedAt = safeInteger(input.issuedAt ?? Date.now(), 'cancellation issuedAt');
  const taskCheck = await verifyAccordTask(task, { now: issuedAt });
  if (!taskCheck.valid) throw new Error(`Cannot cancel invalid Accord task: ${taskCheck.reason}`);
  const normalized = normalizeCancellation({
    format: ACCORD_CANCELLATION_V1_FORMAT,
    taskId: task.taskId,
    requesterId: task.requesterId,
    executorId: task.executorId,
    cancelledById: input.cancelledById,
    reason: input.reason,
    effectiveAt: input.effectiveAt ?? issuedAt,
    issuedAt,
    notBefore: issuedAt,
    expiresAt: task.expiresAt,
    nonce: input.nonce,
  });
  return finishSignedAccordRecord(normalized, 'cancellationId', signer);
}

export async function verifyAccordCancellation(record, {
  task,
  now = Date.now(),
  authorizeCanceller = null,
  replayGuard = null,
  allowExpired = false,
} = {}) {
  const signed = await verifySignedAccordRecord(record, { format: ACCORD_CANCELLATION_V1_FORMAT, idField: 'cancellationId' });
  if (!signed.valid) return signed;
  try {
    const taskCheck = await verifyAccordTask(task, { now, allowExpired, replayGuard: null });
    if (!taskCheck.valid) return Object.freeze({ valid: false, reason: `task-${taskCheck.reason}` });
    const cancellation = normalizeCancellation(record, { signed: true });
    if (!normalizedBodyMatches(record, cancellation)) return Object.freeze({ valid: false, reason: 'non-canonical-record' });
    if (cancellation.taskId !== task.taskId || cancellation.requesterId !== task.requesterId || cancellation.executorId !== task.executorId) {
      return Object.freeze({ valid: false, reason: 'task-binding-mismatch' });
    }
    if (cancellation.expiresAt !== task.expiresAt) return Object.freeze({ valid: false, reason: 'cancellation-window-mismatch' });
    const active = validateActiveWindow(cancellation, now, { allowExpired });
    if (!active.valid) return active;
    const authorized = await authorizeWith(authorizeCanceller, record, 'canceller');
    if (!authorized.valid) return authorized;
    const replay = consumeReplay(replayGuard, record, { idField: 'cancellationId' });
    if (!replay.valid) return replay;
    return Object.freeze({ ...signed, cancellation });
  } catch (error) {
    return Object.freeze({ valid: false, reason: error?.message ?? 'cancellation-invalid' });
  }
}

function normalizeOutput(value, index) {
  exactKeys(value, ['kind', 'outputId', 'reference', 'summary'], `result outputs[${index}]`);
  const kind = boundedToken(value.kind, `result outputs[${index}].kind`, 64);
  if (!OUTPUT_KINDS.has(kind)) throw new TypeError(`Unsupported Accord result output kind: ${kind}`);
  return Object.freeze({
    outputId: boundedToken(value.outputId, `result outputs[${index}].outputId`, 96),
    kind,
    reference: normalizeReference(value.reference, `result outputs[${index}].reference`),
    summary: boundedText(value.summary, `result outputs[${index}].summary`, 512),
  });
}

function normalizeResult(input, { signed = false } = {}) {
  const expected = [
    'acceptanceId', 'approvalProofIds', 'branchId', 'completedAt',
    'contextCapsuleIds', 'delegationId', 'executorId', 'expiresAt', 'format',
    'issuedAt', 'nonce', 'notBefore', 'outputs', 'realmId', 'requesterId',
    'startedAt', 'status', 'taskId', 'usage',
  ];
  if (signed) expected.push('resultId', 'signatureHex', 'signer');
  exactKeys(input, expected, 'Accord result');
  if (input.format !== ACCORD_RESULT_V1_FORMAT) throw new TypeError('Accord result format is invalid');
  const status = String(input.status ?? '').trim().toLowerCase();
  if (!RESULT_STATES.has(status)) throw new TypeError('Accord result status is invalid');
  if (!Array.isArray(input.outputs) || input.outputs.length > 128) throw new TypeError('Accord result outputs must be a bounded array');
  const outputs = input.outputs.map(normalizeOutput).sort((a, b) => a.outputId.localeCompare(b.outputId));
  if (new Set(outputs.map(output => output.outputId)).size !== outputs.length) throw new TypeError('Accord result output IDs must be unique');
  const approvalProofIds = input.approvalProofIds.map((id, index) => assertSecureRecordId(id, `approvalProofIds[${index}]`)).sort();
  const contextCapsuleIds = input.contextCapsuleIds.map((id, index) => assertSecureRecordId(id, `contextCapsuleIds[${index}]`)).sort();
  if (new Set(approvalProofIds).size !== approvalProofIds.length || new Set(contextCapsuleIds).size !== contextCapsuleIds.length) {
    throw new TypeError('Accord result proof and context references must be unique');
  }
  const window = normalizeWindow(input);
  const startedAt = safeInteger(input.startedAt, 'result startedAt');
  const completedAt = safeInteger(input.completedAt, 'result completedAt', startedAt);
  if (completedAt > window.issuedAt || window.issuedAt >= window.expiresAt) throw new RangeError('Accord result completion window is invalid');
  return Object.freeze({
    format: ACCORD_RESULT_V1_FORMAT,
    taskId: assertSecureRecordId(input.taskId, 'result task ID'),
    acceptanceId: assertSecureRecordId(input.acceptanceId, 'result acceptance ID'),
    delegationId: assertSecureRecordId(input.delegationId, 'result delegation ID'),
    requesterId: assertIdentityId(input.requesterId, 'result requester ID'),
    executorId: assertIdentityId(input.executorId, 'result executor ID'),
    realmId: assertRealmId(input.realmId, REALM_ID_TYPE.REALM, 'result Realm ID'),
    branchId: assertRealmId(input.branchId, REALM_ID_TYPE.BRANCH, 'result Branch ID'),
    status,
    outputs: Object.freeze(outputs),
    usage: normalizeBudget(input.usage, 'result usage', { allowZero: true }),
    approvalProofIds: Object.freeze(approvalProofIds),
    contextCapsuleIds: Object.freeze(contextCapsuleIds),
    startedAt,
    completedAt,
    ...window,
    nonce: normalizeNonce(input.nonce),
  });
}

export async function createAccordResultV1(task, acceptance, delegation, input, signer) {
  allowedKeys(input, ['approvalProofIds', 'completedAt', 'contextCapsuleIds', 'expiresAt', 'issuedAt', 'nonce', 'outputs', 'startedAt', 'status', 'usage'], 'Accord result input');
  const issuedAt = safeInteger(input.issuedAt ?? Date.now(), 'result issuedAt');
  const accepted = await verifyAccordTaskAcceptance(acceptance, { task, now: issuedAt });
  if (!accepted.valid) throw new Error(`Cannot create result for invalid acceptance: ${accepted.reason}`);
  const window = normalizeWindow({ issuedAt, notBefore: issuedAt, expiresAt: input.expiresAt ?? acceptance.expiresAt });
  if (window.expiresAt > acceptance.expiresAt) throw new RangeError('Accord result cannot outlive task acceptance');
  const normalized = normalizeResult({
    format: ACCORD_RESULT_V1_FORMAT,
    taskId: task.taskId,
    acceptanceId: acceptance.acceptanceId,
    delegationId: delegation.delegationId,
    requesterId: task.requesterId,
    executorId: task.executorId,
    realmId: task.realmId,
    branchId: task.branchId,
    status: input.status,
    outputs: input.outputs ?? [],
    usage: input.usage ?? {},
    approvalProofIds: input.approvalProofIds ?? [],
    contextCapsuleIds: input.contextCapsuleIds ?? [],
    startedAt: input.startedAt,
    completedAt: input.completedAt ?? issuedAt,
    ...window,
    nonce: input.nonce,
  });
  if (!budgetWithin(normalized.usage, acceptance.acceptedBudget) || !budgetWithin(normalized.usage, delegation.budget)) {
    throw new RangeError('Accord result usage exceeds its accepted delegation budget');
  }
  if (normalized.startedAt < acceptance.notBefore || normalized.completedAt >= acceptance.expiresAt) {
    throw new RangeError('Accord result execution falls outside task acceptance');
  }
  return finishSignedAccordRecord(normalized, 'resultId', signer);
}

export async function verifyAccordResultV1(record, {
  task,
  acceptance,
  delegation,
  capabilityGrant,
  verifyCapabilityGrant,
  contextCapsules = [],
  approvalProofs = [],
  cancellation = null,
  now = Date.now(),
  authorizeExecutor = null,
  replayGuard = null,
  allowExpired = false,
} = {}) {
  const signed = await verifySignedAccordRecord(record, { format: ACCORD_RESULT_V1_FORMAT, idField: 'resultId' });
  if (!signed.valid) return signed;
  try {
    const accepted = await verifyAccordTaskAcceptance(acceptance, { task, now, allowExpired, replayGuard: null });
    if (!accepted.valid) return Object.freeze({ valid: false, reason: `acceptance-${accepted.reason}` });
    const delegated = await verifyAccordDelegation(delegation, {
      task,
      acceptance,
      capabilityGrant,
      verifyCapabilityGrant,
      now,
      allowExpired,
      replayGuard: null,
    });
    if (!delegated.valid) return Object.freeze({ valid: false, reason: `delegation-${delegated.reason}` });
    const result = normalizeResult(record, { signed: true });
    if (!normalizedBodyMatches(record, result)) return Object.freeze({ valid: false, reason: 'non-canonical-record' });
    const source = { ...task, acceptanceId: acceptance.acceptanceId, delegationId: delegation.delegationId };
    const bindings = ['taskId', 'acceptanceId', 'delegationId', 'requesterId', 'executorId', 'realmId', 'branchId'];
    if (bindings.some(field => result[field] !== source[field])) return Object.freeze({ valid: false, reason: 'task-binding-mismatch' });
    if (result.expiresAt > acceptance.expiresAt || result.expiresAt > delegation.expiresAt) return Object.freeze({ valid: false, reason: 'result-outlives-authority' });
    if (result.startedAt < acceptance.notBefore || result.completedAt >= acceptance.expiresAt) return Object.freeze({ valid: false, reason: 'execution-window-invalid' });
    if (!budgetWithin(result.usage, acceptance.acceptedBudget) || !budgetWithin(result.usage, delegation.budget)) {
      return Object.freeze({ valid: false, reason: 'budget-exceeded' });
    }
    if (contextCapsules.length !== result.contextCapsuleIds.length) return Object.freeze({ valid: false, reason: 'context-set-incomplete' });
    const contextIds = [];
    const acceptedContexts = [];
    for (const capsule of contextCapsules) {
      const checked = await verifyContextCapsuleV1(capsule, {
        task,
        acceptance,
        now,
        allowExpired,
        expectedRecipientId: task.executorId,
        priorCapsules: acceptedContexts,
        replayGuard: null,
      });
      if (!checked.valid) return Object.freeze({ valid: false, reason: `context-${checked.reason}` });
      contextIds.push(capsule.contextCapsuleId);
      acceptedContexts.push(checked.contextCapsule);
    }
    if (canonicalize(contextIds.sort()) !== canonicalize(result.contextCapsuleIds)) return Object.freeze({ valid: false, reason: 'context-set-mismatch' });
    const approvedBy = new Set();
    const approvalIds = [];
    for (const proof of approvalProofs) {
      const checked = await verifyAccordApprovalProof(proof, { task, now, allowExpired, replayGuard: null });
      if (!checked.valid) return Object.freeze({ valid: false, reason: `approval-${checked.reason}` });
      if (checked.approval.decision !== 'approved') return Object.freeze({ valid: false, reason: 'task-denied' });
      approvedBy.add(checked.approval.approverId);
      approvalIds.push(proof.approvalProofId);
    }
    if (canonicalize(approvalIds.sort()) !== canonicalize(result.approvalProofIds)) return Object.freeze({ valid: false, reason: 'approval-set-mismatch' });
    if (task.approvalPolicy.required && approvedBy.size < task.approvalPolicy.minimumApprovals) {
      return Object.freeze({ valid: false, reason: 'approval-quorum-not-met' });
    }
    if (cancellation) {
      const cancelled = await verifyAccordCancellation(cancellation, { task, now, allowExpired, replayGuard: null });
      if (!cancelled.valid) return Object.freeze({ valid: false, reason: `cancellation-${cancelled.reason}` });
      if (cancelled.cancellation.effectiveAt <= result.completedAt && result.status !== 'cancelled') {
        return Object.freeze({ valid: false, reason: 'result-after-cancellation' });
      }
    }
    const active = validateActiveWindow(result, now, { allowExpired });
    if (!active.valid) return active;
    const authorized = await authorizeWith(authorizeExecutor, record, 'result-executor');
    if (!authorized.valid) return authorized;
    const replay = consumeReplay(replayGuard, record, { idField: 'resultId' });
    if (!replay.valid) return replay;
    return Object.freeze({ ...signed, result });
  } catch (error) {
    return Object.freeze({ valid: false, reason: error?.message ?? 'result-invalid' });
  }
}

function normalizeReputation(input, { signed = false } = {}) {
  const expected = [
    'domain', 'expiresAt', 'format', 'issuedAt', 'issuerId', 'nonce', 'notBefore',
    'outcome', 'purpose', 'resultId', 'score', 'scope', 'subjectId', 'taskId',
  ];
  if (signed) expected.push('evidenceId', 'signatureHex', 'signer');
  exactKeys(input, expected, 'Accord reputation evidence');
  if (input.format !== ACCORD_REPUTATION_EVIDENCE_V1_FORMAT) throw new TypeError('Accord reputation evidence format is invalid');
  const outcome = String(input.outcome ?? '').trim().toLowerCase();
  if (!REPUTATION_OUTCOMES.has(outcome)) throw new TypeError('Accord reputation outcome is invalid');
  const score = Number(input.score);
  if (!Number.isSafeInteger(score) || score < -1000 || score > 1000) throw new TypeError('Accord reputation score must be an integer from -1000 through 1000');
  return Object.freeze({
    format: ACCORD_REPUTATION_EVIDENCE_V1_FORMAT,
    issuerId: assertIdentityId(input.issuerId, 'reputation issuer ID'),
    subjectId: assertIdentityId(input.subjectId, 'reputation subject ID'),
    taskId: assertSecureRecordId(input.taskId, 'reputation task ID'),
    resultId: assertSecureRecordId(input.resultId, 'reputation result ID'),
    domain: boundedToken(input.domain, 'reputation domain', 96),
    purpose: boundedToken(input.purpose, 'reputation purpose', 96),
    scope: normalizeScope(input.scope, 'reputation scope'),
    outcome,
    score,
    ...normalizeWindow(input, { maximumLifetimeMs: 90 * 24 * 60 * 60 * 1000 }),
    nonce: normalizeNonce(input.nonce),
  });
}

export async function createAccordReputationEvidence(task, result, input, signer) {
  allowedKeys(input, ['domain', 'expiresAt', 'issuedAt', 'issuerId', 'nonce', 'notBefore', 'outcome', 'purpose', 'score', 'scope', 'subjectId'], 'Accord reputation input');
  if (!task || !result || result.taskId !== task.taskId
    || result.requesterId !== task.requesterId || result.executorId !== task.executorId) {
    throw new TypeError('Accord reputation evidence requires a result bound to its task');
  }
  const issuedAt = safeInteger(input.issuedAt ?? Date.now(), 'reputation issuedAt');
  const window = normalizeWindow({
    issuedAt,
    notBefore: input.notBefore ?? issuedAt,
    expiresAt: input.expiresAt,
  }, { maximumLifetimeMs: 90 * 24 * 60 * 60 * 1000 });
  const normalized = normalizeReputation({
    format: ACCORD_REPUTATION_EVIDENCE_V1_FORMAT,
    issuerId: input.issuerId,
    subjectId: input.subjectId,
    taskId: task.taskId,
    resultId: result.resultId,
    domain: input.domain,
    purpose: input.purpose,
    scope: input.scope ?? task.scope,
    outcome: input.outcome,
    score: input.score,
    ...window,
    nonce: input.nonce,
  });
  return finishSignedAccordRecord(normalized, 'evidenceId', signer);
}

export async function verifyAccordReputationEvidence(record, {
  now = Date.now(),
  expectedDomain = null,
  expectedPurpose = null,
  expectedIssuerId = null,
  expectedSubjectId = null,
  expectedTaskId = null,
  expectedResultId = null,
  expectedScope = null,
  authorizeIssuer = null,
  replayGuard = null,
  allowExpired = false,
} = {}) {
  const signed = await verifySignedAccordRecord(record, { format: ACCORD_REPUTATION_EVIDENCE_V1_FORMAT, idField: 'evidenceId' });
  if (!signed.valid) return signed;
  try {
    const evidence = normalizeReputation(record, { signed: true });
    if (!normalizedBodyMatches(record, evidence)) return Object.freeze({ valid: false, reason: 'non-canonical-record' });
    if (expectedDomain !== null && evidence.domain !== expectedDomain) return Object.freeze({ valid: false, reason: 'reputation-domain-mismatch' });
    if (expectedPurpose !== null && evidence.purpose !== expectedPurpose) return Object.freeze({ valid: false, reason: 'reputation-purpose-mismatch' });
    if (expectedIssuerId !== null && evidence.issuerId !== expectedIssuerId) return Object.freeze({ valid: false, reason: 'reputation-issuer-mismatch' });
    if (expectedSubjectId !== null && evidence.subjectId !== expectedSubjectId) return Object.freeze({ valid: false, reason: 'reputation-subject-mismatch' });
    if (expectedTaskId !== null && evidence.taskId !== expectedTaskId) return Object.freeze({ valid: false, reason: 'reputation-task-mismatch' });
    if (expectedResultId !== null && evidence.resultId !== expectedResultId) return Object.freeze({ valid: false, reason: 'reputation-result-mismatch' });
    if (expectedScope !== null && canonicalize(evidence.scope) !== canonicalize(normalizeScope(expectedScope, 'expected reputation scope'))) {
      return Object.freeze({ valid: false, reason: 'reputation-scope-mismatch' });
    }
    const active = validateActiveWindow(evidence, now, { allowExpired });
    if (!active.valid) return active;
    const authorized = await authorizeWith(authorizeIssuer, record, 'reputation-issuer');
    if (!authorized.valid) return authorized;
    const replay = consumeReplay(replayGuard, record, { idField: 'evidenceId' });
    if (!replay.valid) return replay;
    return Object.freeze({ ...signed, evidence });
  } catch (error) {
    return Object.freeze({ valid: false, reason: error?.message ?? 'reputation-evidence-invalid' });
  }
}

export const AccordResultV1 = Object.freeze({
  format: ACCORD_RESULT_V1_FORMAT,
  create: createAccordResultV1,
  verify: verifyAccordResultV1,
  createProgress: createAccordProgress,
  verifyProgress: verifyAccordProgress,
  createCancellation: createAccordCancellation,
  verifyCancellation: verifyAccordCancellation,
  createReputationEvidence: createAccordReputationEvidence,
  verifyReputationEvidence: verifyAccordReputationEvidence,
});
