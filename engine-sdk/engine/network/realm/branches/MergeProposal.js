// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/** MergeProposalV1 contracts, dependency-safe decisions, and merge commits. */

import { canonicalize, hashIdSecure } from '../../../state/util/canonical.js';
import { assertRealmId, REALM_ID_TYPE } from '../addressing/RealmIds.js';
import {
  createChronicleEvent,
  verifyChronicleEvent,
} from '../chronicle/RealmChronicle.js';
import { deepFreeze } from '../capsule/RealmCapsuleSchema.js';
import {
  REALM_BRANCH_PURPOSE,
  createRealmBranch,
} from './RealmBranch.js';
import { signBranchRecord, verifyBranchRecord } from './RealmBranchCrypto.js';
import {
  SEMANTIC_COMPARISON_FORMAT,
  applySemanticChange,
  createDefaultSemanticAdapterRegistry,
  hashSemanticChange,
  normalizeSemanticSnapshot,
  orderSemanticChanges,
} from './SemanticAdapters.js';

export const MERGE_PROPOSAL_FORMAT = 'realm-merge-proposal-v1';
export const MERGE_COMMIT_PAYLOAD_FORMAT = 'realm-merge-commit-v1';

const SECURE_ID = /^sha256:256:[0-9a-f]{64}$/;
const TOKEN = /^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,255}$/;
const MAX_CHANGES = 10000;
const MAX_DEPENDENCIES = 4096;
const CHANGE_FIELDS = new Set([
  'changeId', 'recordId', 'recordType', 'operation', 'path', 'base', 'mine',
  'theirs', 'proposed', 'conflict', 'recordDependencyIds', 'dependencies',
]);
const PROPOSAL_FIELDS = new Set([
  'format', 'schemaVersion', 'realmId', 'targetBranchId', 'sourceBranchId',
  'proposerId', 'baseHeadId', 'mineHeadId', 'theirsHeadId', 'baseRoot',
  'mineRoot', 'theirsRoot', 'changes', 'createdAt', 'expiresAt', 'signer',
  'proposalId', 'signatureHex',
]);

function safeInteger(value, name, minimum = 0) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < minimum) throw new TypeError(`${name} is invalid`);
  return number;
}

function secureId(value, name) {
  const text = String(value ?? '');
  if (!SECURE_ID.test(text)) throw new TypeError(`${name} is invalid`);
  return text;
}

function token(value, name) {
  const text = String(value ?? '').trim();
  if (!TOKEN.test(text)) throw new TypeError(`${name} is invalid`);
  return text;
}

function pathPart(value) {
  const text = String(value ?? '');
  if (!text || text.length > 256 || /[\u0000-\u001f\u007f]/.test(text)) {
    throw new TypeError('semantic change path part is invalid');
  }
  return text;
}

function normalizeSlot(value, name, allowNull = false) {
  if (value === null && allowNull) return null;
  if (!value || typeof value !== 'object' || typeof value.present !== 'boolean') {
    throw new TypeError(`${name} is invalid`);
  }
  return value.present
    ? deepFreeze({ present: true, value: JSON.parse(canonicalize(value.value)) })
    : Object.freeze({ present: false, value: null });
}

function secureIds(values, name, max = MAX_DEPENDENCIES) {
  if (!Array.isArray(values) || values.length > max) throw new TypeError(`${name} must be a bounded array`);
  const normalized = [...new Set(values.map((value) => secureId(value, name)))].sort();
  if (normalized.length !== values.length) throw new TypeError(`${name} contains duplicates`);
  return Object.freeze(normalized);
}

async function normalizeChange(value) {
  if (!value || typeof value !== 'object') throw new TypeError('semantic merge change is invalid');
  if (Object.keys(value).some((key) => !CHANGE_FIELDS.has(key))) {
    throw new TypeError('semantic merge change has an unknown field');
  }
  const operation = String(value.operation ?? '');
  if (!['record', 'field', 'value', 'dependencies'].includes(operation)) {
    throw new TypeError('semantic merge change operation is invalid');
  }
  if (!Array.isArray(value.path) || value.path.length > 32) throw new TypeError('semantic merge change path is invalid');
  const change = {
    changeId: secureId(value.changeId, 'semantic change ID'),
    recordId: token(value.recordId, 'semantic change record ID'),
    recordType: token(value.recordType, 'semantic change record type'),
    operation,
    path: Object.freeze(value.path.map(pathPart)),
    base: normalizeSlot(value.base, 'semantic change base slot'),
    mine: normalizeSlot(value.mine, 'semantic change mine slot'),
    theirs: normalizeSlot(value.theirs, 'semantic change theirs slot'),
    proposed: normalizeSlot(value.proposed, 'semantic change proposed slot', true),
    conflict: value.conflict === true,
    recordDependencyIds: Object.freeze((value.recordDependencyIds ?? []).map((id) => token(id, 'record dependency ID')).sort()),
    dependencies: secureIds(value.dependencies ?? [], 'semantic change dependencies'),
  };
  if (change.conflict === (change.proposed !== null)) {
    throw new Error('semantic change conflict/proposed state is inconsistent');
  }
  if (await hashSemanticChange(change) !== change.changeId) {
    throw new Error('semantic change ID mismatch');
  }
  return deepFreeze(change);
}

async function normalizeProposalBody(value) {
  if (!value || typeof value !== 'object') throw new TypeError('MergeProposalV1 is invalid');
  if (Object.keys(value).some((key) => !PROPOSAL_FIELDS.has(key))) {
    throw new TypeError('MergeProposalV1 has an unknown field');
  }
  if (!Array.isArray(value.changes) || value.changes.length > MAX_CHANGES) {
    throw new TypeError('MergeProposalV1 changes must be a bounded array');
  }
  const changes = [];
  for (const change of value.changes) changes.push(await normalizeChange(change));
  const changeIds = new Set(changes.map((change) => change.changeId));
  if (changeIds.size !== changes.length) throw new Error('MergeProposalV1 contains duplicate changes');
  for (const change of changes) {
    if (change.dependencies.some((dependency) => !changeIds.has(dependency))) {
      throw new Error('MergeProposalV1 change references an unknown dependency');
    }
  }
  orderSemanticChanges(changes);
  const createdAt = safeInteger(value.createdAt, 'MergeProposalV1 createdAt');
  const expiresAt = safeInteger(value.expiresAt, 'MergeProposalV1 expiresAt');
  if (expiresAt <= createdAt) throw new Error('MergeProposalV1 expiry must follow creation');
  return {
    format: MERGE_PROPOSAL_FORMAT,
    schemaVersion: 1,
    realmId: assertRealmId(value.realmId, REALM_ID_TYPE.REALM, 'Realm ID'),
    targetBranchId: assertRealmId(value.targetBranchId, REALM_ID_TYPE.BRANCH, 'target Branch ID'),
    sourceBranchId: assertRealmId(value.sourceBranchId, REALM_ID_TYPE.BRANCH, 'source Branch ID'),
    proposerId: assertRealmId(value.proposerId, null, 'merge proposer ID'),
    baseHeadId: secureId(value.baseHeadId, 'base branch head ID'),
    mineHeadId: secureId(value.mineHeadId, 'mine branch head ID'),
    theirsHeadId: secureId(value.theirsHeadId, 'theirs branch head ID'),
    baseRoot: secureId(value.baseRoot, 'base state root'),
    mineRoot: secureId(value.mineRoot, 'mine state root'),
    theirsRoot: secureId(value.theirsRoot, 'theirs state root'),
    changes: Object.freeze(changes),
    createdAt,
    expiresAt,
  };
}

/** Create a signed MergeProposalV1 from a semantic comparison. */
export async function createMergeProposal(input, signer) {
  if (!input?.comparison || input.comparison.format !== SEMANTIC_COMPARISON_FORMAT) {
    throw new TypeError('a verified semantic comparison is required');
  }
  const body = await normalizeProposalBody({
    format: MERGE_PROPOSAL_FORMAT,
    schemaVersion: 1,
    realmId: input.realmId,
    targetBranchId: input.targetBranchId,
    sourceBranchId: input.sourceBranchId,
    proposerId: input.proposerId,
    baseHeadId: input.baseHeadId,
    mineHeadId: input.mineHeadId,
    theirsHeadId: input.theirsHeadId,
    baseRoot: input.comparison.baseRoot,
    mineRoot: input.comparison.mineRoot,
    theirsRoot: input.comparison.theirsRoot,
    changes: input.comparison.changes,
    createdAt: input.createdAt ?? Date.now(),
    expiresAt: input.expiresAt,
  });
  return signBranchRecord(body, {
    idField: 'proposalId',
    format: MERGE_PROPOSAL_FORMAT,
  }, signer);
}

/** Verify proposal signature, IDs, dependency DAG, authorization, and expiry. */
export async function verifyMergeProposal(proposal, options = {}) {
  try {
    if (!proposal || proposal.format !== MERGE_PROPOSAL_FORMAT || proposal.schemaVersion !== 1) {
      return Object.freeze({ valid: false, reason: 'malformed-proposal' });
    }
    const normalized = await normalizeProposalBody(proposal);
    const signed = await verifyBranchRecord(proposal, {
      idField: 'proposalId',
      format: MERGE_PROPOSAL_FORMAT,
    });
    if (!signed.valid) return signed;
    const now = safeInteger(options.now ?? Date.now(), 'merge proposal verification time');
    if (!options.allowExpired && now >= proposal.expiresAt) {
      return Object.freeze({ valid: false, reason: 'proposal-expired' });
    }
    if (typeof options.authorizeProposer === 'function'
      && !(await options.authorizeProposer(proposal.proposerId, proposal.signer.fingerprint, proposal))) {
      return Object.freeze({ valid: false, reason: 'proposer-unauthorized' });
    }
    return Object.freeze({ ...signed, proposal: deepFreeze(normalized) });
  } catch (error) {
    return Object.freeze({ valid: false, reason: error?.message ?? 'proposal-verification-failed' });
  }
}

/** Default policy: accept clean changes and retain conflicts on the source branch. */
export function buildDefaultMergeDecisions(proposal) {
  const decisions = Object.fromEntries(proposal.changes.map((change) => [change.changeId, {
    decision: change.conflict ? 'reject' : 'accept',
  }]));
  let changed = true;
  while (changed) {
    changed = false;
    for (const change of proposal.changes) {
      if (decisions[change.changeId].decision !== 'accept') continue;
      if (change.dependencies.some((dependency) => decisions[dependency]?.decision !== 'accept')) {
        decisions[change.changeId] = { decision: 'reject', reason: 'dependency-rejected' };
        changed = true;
      }
    }
  }
  return deepFreeze(decisions);
}

function normalizeDecision(value, change) {
  const decision = typeof value === 'string' ? value : value?.decision;
  if (decision !== 'accept' && decision !== 'reject') throw new TypeError(`decision missing for change ${change.changeId}`);
  if (decision === 'reject') return Object.freeze({ decision: 'reject', selected: null });
  let selected;
  const resolution = typeof value === 'object' ? value.resolution : null;
  if (resolution == null) {
    if (change.conflict) throw new Error(`conflicting change ${change.changeId} requires an explicit resolution`);
    selected = change.proposed;
  } else if (typeof resolution === 'string') {
    if (!['base', 'mine', 'theirs'].includes(resolution)) throw new TypeError('merge conflict resolution is invalid');
    selected = change[resolution];
  } else {
    selected = normalizeSlot(resolution, 'custom merge resolution');
  }
  return deepFreeze({ decision: 'accept', selected });
}

export function validateMergeDecisions(proposal, decisions) {
  try {
    const source = decisions instanceof Map ? Object.fromEntries(decisions) : decisions;
    if (!source || typeof source !== 'object') throw new TypeError('merge decisions are required');
    const changesById = new Map(proposal.changes.map((change) => [change.changeId, change]));
    for (const id of Object.keys(source)) if (!changesById.has(id)) throw new Error(`decision references unknown change ${id}`);
    const normalized = new Map();
    for (const change of proposal.changes) normalized.set(change.changeId, normalizeDecision(source[change.changeId], change));
    const blocked = [];
    for (const change of proposal.changes) {
      if (normalized.get(change.changeId).decision !== 'accept') continue;
      const missing = change.dependencies.filter((id) => normalized.get(id)?.decision !== 'accept');
      if (missing.length) blocked.push({ changeId: change.changeId, dependencies: missing });
    }
    if (blocked.length) return Object.freeze({ valid: false, reason: 'dependency-rejected', blocked: deepFreeze(blocked) });
    return Object.freeze({ valid: true, decisions: normalized });
  } catch (error) {
    return Object.freeze({ valid: false, reason: error?.message ?? 'invalid-merge-decisions' });
  }
}

async function assertSnapshotRoot(snapshot, expected, label) {
  const normalized = normalizeSemanticSnapshot(snapshot);
  const actual = await hashIdSecure(normalized, {
    domain: 'realm-network.branch-state',
    schemaVersion: 'v1',
  });
  if (actual !== expected) throw new Error(`${label} snapshot root mismatch`);
  return normalized;
}

/** Apply accepted changes to mine; rejected/conflicting source work is untouched. */
export async function applyMergeProposal({ proposal, decisions, base, mine, theirs }, options = {}) {
  const verification = await verifyMergeProposal(proposal, options);
  if (!verification.valid) throw new Error(`merge proposal rejected: ${verification.reason}`);
  await assertSnapshotRoot(base, proposal.baseRoot, 'base');
  let merged = await assertSnapshotRoot(mine, proposal.mineRoot, 'mine');
  const source = await assertSnapshotRoot(theirs, proposal.theirsRoot, 'theirs');
  const checked = validateMergeDecisions(proposal, decisions);
  if (!checked.valid) throw new Error(`merge decisions rejected: ${checked.reason}`);
  const registry = options.registry ?? createDefaultSemanticAdapterRegistry();
  const acceptedChangeIds = [];
  const rejectedChangeIds = [];
  for (const change of orderSemanticChanges(proposal.changes)) {
    const decision = checked.decisions.get(change.changeId);
    if (decision.decision === 'accept') {
      merged = applySemanticChange(merged, change, decision.selected, registry);
      acceptedChangeIds.push(change.changeId);
    } else {
      rejectedChangeIds.push(change.changeId);
    }
  }
  const resultRoot = await hashIdSecure(merged, {
    domain: 'realm-network.branch-state',
    schemaVersion: 'v1',
  });
  return deepFreeze({
    mergedSnapshot: merged,
    resultRoot,
    sourceSnapshot: source,
    acceptedChangeIds: acceptedChangeIds.sort(),
    rejectedChangeIds: rejectedChangeIds.sort(),
  });
}

/**
 * Apply a proposal and publish the decision as a signed Chronicle event.
 * Any rejected work receives a stable signed branch rooted at the source head.
 */
export async function createMergeCommit(input, signer, options = {}) {
  const applied = await applyMergeProposal(input, options);
  const proposal = input.proposal;
  let rejectedBranch = null;
  if (applied.rejectedChangeIds.length) {
    const rejectedSigner = input.rejectedSigner ?? signer;
    rejectedBranch = await createRealmBranch({
      realmId: proposal.realmId,
      ownerId: input.rejectedOwnerId ?? input.actorId,
      lineageNonce: `merge-rejected:${proposal.proposalId.slice(-64)}`,
      label: input.rejectedBranchLabel ?? `Rejected ${proposal.proposalId.slice(-12)}`,
      purpose: REALM_BRANCH_PURPOSE.MERGE_REJECTED,
      fork: {
        branchId: proposal.sourceBranchId,
        headRefHash: proposal.theirsHeadId,
      },
      preservedChangeIds: applied.rejectedChangeIds,
      createdAt: input.occurredAt ?? Date.now(),
    }, rejectedSigner);
  }
  const payload = deepFreeze({
    format: MERGE_COMMIT_PAYLOAD_FORMAT,
    schemaVersion: 1,
    proposalId: proposal.proposalId,
    sourceBranchId: proposal.sourceBranchId,
    baseHeadId: proposal.baseHeadId,
    mineHeadId: proposal.mineHeadId,
    theirsHeadId: proposal.theirsHeadId,
    acceptedChangeIds: applied.acceptedChangeIds,
    rejectedChangeIds: applied.rejectedChangeIds,
    resultRoot: applied.resultRoot,
    rejectedBranchId: rejectedBranch?.branchId ?? null,
  });
  const event = await createChronicleEvent({
    realmId: proposal.realmId,
    branchId: proposal.targetBranchId,
    sequence: input.sequence,
    parents: input.chronicleParents,
    actorId: input.actorId,
    capabilityId: input.capabilityId ?? null,
    operation: 'realm.branch.merge',
    payload,
    stateRootBefore: proposal.mineRoot,
    stateRootAfter: applied.resultRoot,
    occurredAt: input.occurredAt ?? Date.now(),
  }, signer);
  return deepFreeze({
    ...applied,
    commitEvent: event,
    rejectedBranch,
    rejectedSnapshot: rejectedBranch ? applied.sourceSnapshot : null,
  });
}

export async function verifyMergeCommit(event, options = {}) {
  const verified = await verifyChronicleEvent(event, options);
  if (!verified.valid) return verified;
  try {
    if (event.operation !== 'realm.branch.merge'
      || event.payload?.format !== MERGE_COMMIT_PAYLOAD_FORMAT
      || event.payload?.schemaVersion !== 1) {
      return Object.freeze({ valid: false, reason: 'not-a-merge-commit' });
    }
    secureId(event.payload.proposalId, 'merge commit proposal ID');
    secureId(event.payload.resultRoot, 'merge commit result root');
    secureIds(event.payload.acceptedChangeIds, 'merge commit accepted changes', MAX_CHANGES);
    secureIds(event.payload.rejectedChangeIds, 'merge commit rejected changes', MAX_CHANGES);
    if (event.payload.rejectedChangeIds.length > 0
      && !event.payload.rejectedBranchId) return Object.freeze({ valid: false, reason: 'rejected-work-not-preserved' });
    if (event.payload.rejectedBranchId != null) {
      assertRealmId(event.payload.rejectedBranchId, REALM_ID_TYPE.BRANCH, 'rejected Branch ID');
    }
    return verified;
  } catch (error) {
    return Object.freeze({ valid: false, reason: error?.message ?? 'merge-commit-invalid' });
  }
}

/** Public MergeProposalV1 contract. */
export const MergeProposalV1 = Object.freeze({
  format: MERGE_PROPOSAL_FORMAT,
  schemaVersion: 1,
  create: createMergeProposal,
  verify: verifyMergeProposal,
  validateDecisions: validateMergeDecisions,
  apply: applyMergeProposal,
  createCommit: createMergeCommit,
  verifyCommit: verifyMergeCommit,
});
