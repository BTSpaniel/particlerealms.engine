// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/** Recipient-bound, allowlisted, signed context for a single Accord task. */

import { canonicalize } from '../../../state/util/canonical.js';
import { REALM_ID_TYPE, assertRealmId, isRealmId } from '../addressing/RealmIds.js';
import { ACCORD_CONTEXT_KINDS } from './AccordCapabilityV1.js';
import {
  assertIdentityId,
  assertSecureRecordId,
  authorizeWith,
  boundedText,
  boundedToken,
  canonicalPublicCopy,
  exactKeys,
  finishSignedAccordRecord,
  normalizeNonce,
  normalizedBodyMatches,
  normalizeTokenList,
  normalizeWindow,
  safeInteger,
  validateActiveWindow,
  verifySignedAccordRecord,
} from './AccordCrypto.js';
import { consumeReplay } from './AccordReplayGuard.js';
import { verifyAccordTask, verifyAccordTaskAcceptance } from './AccordTaskV1.js';

export const CONTEXT_CAPSULE_V1_FORMAT = 'realm-context-capsule-v1';

const REFERENCE_KINDS = new Set(['approval-proof', 'asset-ref', 'capsule-ref', 'chronicle-ref']);
const PUBLIC_VALUE_KINDS = new Set(['constraint', 'instruction', 'public-profile', 'realm-record']);
const CONTEXT_KIND_SET = new Set(ACCORD_CONTEXT_KINDS);

function allowedKeys(input, allowed, name) {
  const unknown = Object.keys(input ?? {}).filter(key => !allowed.includes(key));
  if (unknown.length) throw new TypeError(`${name} contains unsupported fields: ${unknown.sort().join(', ')}`);
}

function normalizeReference(value, name) {
  const reference = String(value ?? '').trim().toLowerCase();
  if (/^sha256:256:[0-9a-f]{64}$/.test(reference) || isRealmId(reference)) return reference;
  throw new TypeError(`${name} must be an immutable Realm or SHA-256 record reference`);
}

function normalizeEntry(value, index) {
  exactKeys(value, ['entryId', 'kind', 'label', 'payload', 'reference'], `context entries[${index}]`);
  const kind = boundedToken(value.kind, `context entries[${index}].kind`, 64);
  if (!CONTEXT_KIND_SET.has(kind)) throw new TypeError(`Unsupported context entry kind: ${kind}`);
  const base = {
    entryId: boundedToken(value.entryId, `context entries[${index}].entryId`, 96),
    kind,
    label: boundedText(value.label, `context entries[${index}].label`, 160),
  };
  if (REFERENCE_KINDS.has(kind)) {
    if (value.payload !== null) throw new TypeError(`Context ${kind} entry must not contain inline payload data`);
    return Object.freeze({ ...base, reference: normalizeReference(value.reference, `context entries[${index}].reference`), payload: null });
  }
  if (!PUBLIC_VALUE_KINDS.has(kind)) throw new TypeError(`Context kind ${kind} has no safe transfer policy`);
  if (value.reference !== null) throw new TypeError(`Context ${kind} entry must not contain a reference`);
  return Object.freeze({
    ...base,
    reference: null,
    payload: canonicalPublicCopy(value.payload, `context entries[${index}].payload`, { maximumBytes: 64 * 1024 }),
  });
}

function payloadByteLength(entries) {
  return new TextEncoder().encode(canonicalize(entries)).byteLength;
}

function normalizeCapsule(input, { signed = false } = {}) {
  const expected = [
    'allowedKinds', 'branchId', 'entries', 'expiresAt', 'format', 'issuedAt',
    'nonce', 'notBefore', 'payloadBytes', 'realmId', 'recipientId',
    'requesterId', 'taskId',
  ];
  if (signed) expected.push('contextCapsuleId', 'signatureHex', 'signer');
  exactKeys(input, expected, 'Context Capsule');
  if (input.format !== CONTEXT_CAPSULE_V1_FORMAT) throw new TypeError('Context Capsule format is invalid');
  const allowedKinds = normalizeTokenList(input.allowedKinds, 'Context Capsule allowedKinds', { maximum: CONTEXT_KIND_SET.size });
  for (const kind of allowedKinds) {
    if (!CONTEXT_KIND_SET.has(kind)) throw new TypeError(`Unsupported Context Capsule allowlist kind: ${kind}`);
  }
  if (!Array.isArray(input.entries) || input.entries.length === 0 || input.entries.length > 128) {
    throw new TypeError('Context Capsule must contain 1 to 128 entries');
  }
  const entries = input.entries.map(normalizeEntry).sort((a, b) => a.entryId.localeCompare(b.entryId));
  if (new Set(entries.map(entry => entry.entryId)).size !== entries.length) throw new TypeError('Context Capsule entry IDs must be unique');
  if (entries.some(entry => !allowedKinds.includes(entry.kind))) throw new TypeError('Context Capsule contains a kind outside its signed allowlist');
  const actualBytes = payloadByteLength(entries);
  if (safeInteger(input.payloadBytes, 'Context Capsule payloadBytes', 1, 256 * 1024) !== actualBytes) {
    throw new TypeError('Context Capsule payload byte count does not match its canonical entries');
  }
  return Object.freeze({
    format: CONTEXT_CAPSULE_V1_FORMAT,
    taskId: assertSecureRecordId(input.taskId, 'Context Capsule task ID'),
    requesterId: assertIdentityId(input.requesterId, 'Context Capsule requester ID'),
    recipientId: assertIdentityId(input.recipientId, 'Context Capsule recipient ID'),
    realmId: assertRealmId(input.realmId, REALM_ID_TYPE.REALM, 'Context Capsule Realm ID'),
    branchId: assertRealmId(input.branchId, REALM_ID_TYPE.BRANCH, 'Context Capsule Branch ID'),
    allowedKinds,
    entries: Object.freeze(entries),
    payloadBytes: actualBytes,
    ...normalizeWindow(input),
    nonce: normalizeNonce(input.nonce),
  });
}

export async function createContextCapsuleV1(task, input, signer) {
  allowedKeys(input, ['allowedKinds', 'entries', 'expiresAt', 'issuedAt', 'nonce', 'notBefore', 'recipientId'], 'Context Capsule input');
  const issuedAt = safeInteger(input.issuedAt ?? Date.now(), 'Context Capsule issuedAt');
  const taskCheck = await verifyAccordTask(task, { now: issuedAt });
  if (!taskCheck.valid) throw new Error(`Cannot create context for invalid Accord task: ${taskCheck.reason}`);
  const recipientId = input.recipientId ?? task.executorId;
  if (recipientId !== task.executorId) throw new RangeError('Context Capsule recipient must be the task executor');
  const allowedKinds = input.allowedKinds ?? task.contextPolicy.allowedKinds;
  const entries = input.entries.map((entry, index) => normalizeEntry(entry, index));
  const window = normalizeWindow({
    issuedAt,
    notBefore: input.notBefore ?? issuedAt,
    expiresAt: input.expiresAt ?? task.expiresAt,
  });
  if (window.expiresAt > task.expiresAt) throw new RangeError('Context Capsule cannot outlive its task');
  const normalized = normalizeCapsule({
    format: CONTEXT_CAPSULE_V1_FORMAT,
    taskId: task.taskId,
    requesterId: task.requesterId,
    recipientId,
    realmId: task.realmId,
    branchId: task.branchId,
    allowedKinds,
    entries,
    payloadBytes: payloadByteLength(entries),
    ...window,
    nonce: input.nonce,
  });
  if (normalized.allowedKinds.some(kind => !task.contextPolicy.allowedKinds.includes(kind))) {
    throw new RangeError('Context Capsule allowlist exceeds the task context policy');
  }
  if (normalized.payloadBytes > task.contextPolicy.maxBytes) throw new RangeError('Context Capsule exceeds the task context byte budget');
  return finishSignedAccordRecord(normalized, 'contextCapsuleId', signer);
}

export async function verifyContextCapsuleV1(record, {
  task,
  acceptance = null,
  now = Date.now(),
  expectedRecipientId = null,
  authorizeRequester = null,
  priorCapsules = [],
  replayGuard = null,
  allowExpired = false,
} = {}) {
  const signed = await verifySignedAccordRecord(record, { format: CONTEXT_CAPSULE_V1_FORMAT, idField: 'contextCapsuleId' });
  if (!signed.valid) return signed;
  try {
    if (!task) return Object.freeze({ valid: false, reason: 'task-required' });
    const taskCheck = await verifyAccordTask(task, { now, allowExpired, replayGuard: null });
    if (!taskCheck.valid) return Object.freeze({ valid: false, reason: `task-${taskCheck.reason}` });
    let acceptanceView = null;
    if (acceptance) {
      const acceptanceCheck = await verifyAccordTaskAcceptance(acceptance, { task, now, allowExpired, replayGuard: null });
      if (!acceptanceCheck.valid) return Object.freeze({ valid: false, reason: `acceptance-${acceptanceCheck.reason}` });
      acceptanceView = acceptanceCheck.acceptance;
    }
    const capsule = normalizeCapsule(record, { signed: true });
    if (!normalizedBodyMatches(record, capsule)) return Object.freeze({ valid: false, reason: 'non-canonical-record' });
    const bindings = ['taskId', 'requesterId', 'realmId', 'branchId'];
    if (bindings.some(field => capsule[field] !== task[field])) return Object.freeze({ valid: false, reason: 'task-binding-mismatch' });
    if (capsule.recipientId !== task.executorId) return Object.freeze({ valid: false, reason: 'recipient-task-mismatch' });
    if (expectedRecipientId !== null && capsule.recipientId !== expectedRecipientId) return Object.freeze({ valid: false, reason: 'recipient-mismatch' });
    if (capsule.expiresAt > task.expiresAt) return Object.freeze({ valid: false, reason: 'context-outlives-task' });
    const policyKinds = acceptanceView?.acceptedContextKinds ?? task.contextPolicy.allowedKinds;
    if (capsule.allowedKinds.some(kind => !policyKinds.includes(kind))) return Object.freeze({ valid: false, reason: 'context-policy-escalation' });
    if (!Array.isArray(priorCapsules) || priorCapsules.length >= task.contextPolicy.maxCapsules) {
      return Object.freeze({ valid: false, reason: 'context-capsule-count-exceeded' });
    }
    const priorBytes = priorCapsules.reduce((sum, prior) => sum + safeInteger(prior.payloadBytes, 'prior context payloadBytes', 1), 0);
    if (priorBytes + capsule.payloadBytes > task.contextPolicy.maxBytes) return Object.freeze({ valid: false, reason: 'context-byte-budget-exceeded' });
    const active = validateActiveWindow(capsule, now, { allowExpired });
    if (!active.valid) return active;
    const authorized = await authorizeWith(authorizeRequester, record, 'context-requester');
    if (!authorized.valid) return authorized;
    const replay = consumeReplay(replayGuard, record, { idField: 'contextCapsuleId' });
    if (!replay.valid) return replay;
    return Object.freeze({ ...signed, contextCapsule: capsule });
  } catch (error) {
    return Object.freeze({ valid: false, reason: error?.message ?? 'context-capsule-invalid' });
  }
}

export const ContextCapsuleV1 = Object.freeze({
  format: CONTEXT_CAPSULE_V1_FORMAT,
  create: createContextCapsuleV1,
  verify: verifyContextCapsuleV1,
  allowedKinds: ACCORD_CONTEXT_KINDS,
});
