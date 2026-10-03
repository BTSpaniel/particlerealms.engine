// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/** RealmBranchV1 identity, ownership, signed-head chains, and branch DAGs. */

import { dependsOn, link, toposort } from '../../../state/facts/Causality.js';
import { canonicalize } from '../../../state/util/canonical.js';
import {
  REALM_ID_TYPE,
  assertRealmId,
  createRealmId,
} from '../addressing/RealmIds.js';
import {
  hashRealmBranchRef,
  verifyRealmBranchRef,
} from '../capsule/RealmBranchRef.js';
import { deepFreeze } from '../capsule/RealmCapsuleSchema.js';
import { signBranchRecord, verifyBranchRecord } from './RealmBranchCrypto.js';

export const REALM_BRANCH_FORMAT = 'realm-branch-v1';
export const REALM_BRANCH_PURPOSE = Object.freeze({
  MAIN: 'main',
  OFFLINE: 'offline',
  FORK: 'fork',
  MERGE_REJECTED: 'merge-rejected',
});

const PURPOSES = new Set(Object.values(REALM_BRANCH_PURPOSE));
const SECURE_ID = /^sha256:256:[0-9a-f]{64}$/;
const TOKEN = /^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,255}$/;
const MAX_PRESERVED_CHANGES = 4096;
const BRANCH_FIELDS = new Set([
  'format', 'schemaVersion', 'realmId', 'branchId', 'ownerId', 'lineageNonce',
  'label', 'purpose', 'fork', 'preservedChangeIds', 'createdAt', 'signer',
  'descriptorId', 'signatureHex',
]);

function boundedString(value, name, max = 256, pattern = null) {
  const text = String(value ?? '').trim();
  if (!text || text.length > max || (pattern && !pattern.test(text))) {
    throw new TypeError(`${name} is invalid`);
  }
  return text;
}

function safeTime(value, name) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 0) throw new TypeError(`${name} is invalid`);
  return number;
}

function secureIds(values, name, max = MAX_PRESERVED_CHANGES) {
  if (!Array.isArray(values) || values.length > max) throw new TypeError(`${name} must be a bounded array`);
  const normalized = [...new Set(values.map((value) => boundedString(value, name, 96, SECURE_ID)))].sort();
  if (normalized.length !== values.length) throw new TypeError(`${name} must not contain duplicates`);
  return Object.freeze(normalized);
}

function normalizeFork(value) {
  if (value == null) return null;
  return Object.freeze({
    branchId: assertRealmId(value.branchId, REALM_ID_TYPE.BRANCH, 'fork branch ID'),
    headRefHash: boundedString(value.headRefHash, 'fork head ref hash', 96, SECURE_ID),
  });
}

function normalizeBranchBody(value) {
  const purpose = boundedString(value.purpose ?? REALM_BRANCH_PURPOSE.FORK, 'branch purpose', 32);
  if (!PURPOSES.has(purpose)) throw new TypeError('unsupported Realm branch purpose');
  const fork = normalizeFork(value.fork);
  if (purpose === REALM_BRANCH_PURPOSE.MAIN && fork !== null) throw new TypeError('main branch cannot declare a fork parent');
  if (purpose !== REALM_BRANCH_PURPOSE.MAIN && fork === null) throw new TypeError(`${purpose} branch requires a fork parent`);
  return {
    format: REALM_BRANCH_FORMAT,
    schemaVersion: 1,
    realmId: assertRealmId(value.realmId, REALM_ID_TYPE.REALM, 'Realm ID'),
    branchId: assertRealmId(value.branchId, REALM_ID_TYPE.BRANCH, 'Branch ID'),
    ownerId: assertRealmId(value.ownerId, null, 'branch owner ID'),
    lineageNonce: boundedString(value.lineageNonce, 'branch lineage nonce', 256, TOKEN),
    label: boundedString(value.label, 'branch label', 128),
    purpose,
    fork,
    preservedChangeIds: secureIds(value.preservedChangeIds ?? [], 'preserved change IDs'),
    createdAt: safeTime(value.createdAt, 'branch createdAt'),
  };
}

async function expectedBranchId(body) {
  return createRealmId(REALM_ID_TYPE.BRANCH, {
    realmId: body.realmId,
    ownerId: body.ownerId,
    lineageNonce: body.lineageNonce,
  });
}

/**
 * Create a stable RealmBranchV1. The label is intentionally excluded from the
 * identity derivation, so renaming or alias changes cannot change branch IDs.
 */
export async function createRealmBranch(input, signer) {
  if (!input || typeof input !== 'object') throw new TypeError('Realm branch input is required');
  const derivedId = await createRealmId(REALM_ID_TYPE.BRANCH, {
    realmId: assertRealmId(input.realmId, REALM_ID_TYPE.REALM, 'Realm ID'),
    ownerId: assertRealmId(input.ownerId, null, 'branch owner ID'),
    lineageNonce: boundedString(input.lineageNonce, 'branch lineage nonce', 256, TOKEN),
  });
  if (input.branchId != null && input.branchId !== derivedId) {
    throw new Error('supplied branch ID does not match stable branch control material');
  }
  const body = normalizeBranchBody({
    ...input,
    branchId: derivedId,
    createdAt: input.createdAt ?? Date.now(),
  });
  return signBranchRecord(body, {
    idField: 'descriptorId',
    format: REALM_BRANCH_FORMAT,
  }, signer);
}

/** Verify branch identity, controller signature, and optional owner authority. */
export async function verifyRealmBranch(branch, options = {}) {
  try {
    if (!branch || branch.format !== REALM_BRANCH_FORMAT || branch.schemaVersion !== 1) {
      return Object.freeze({ valid: false, reason: 'malformed-branch' });
    }
    if (Object.keys(branch).some((key) => !BRANCH_FIELDS.has(key))) {
      return Object.freeze({ valid: false, reason: 'unknown-branch-field' });
    }
    const body = normalizeBranchBody(branch);
    if (body.branchId !== await expectedBranchId(body)) {
      return Object.freeze({ valid: false, reason: 'branch-id-mismatch' });
    }
    const signed = await verifyBranchRecord(branch, {
      idField: 'descriptorId',
      format: REALM_BRANCH_FORMAT,
    });
    if (!signed.valid) return signed;
    let authorized = null;
    if (typeof options.authorizeOwner === 'function') {
      authorized = !!(await options.authorizeOwner(
        branch.ownerId,
        branch.signer.fingerprint,
        branch,
      ));
      if (!authorized) return Object.freeze({ valid: false, reason: 'branch-owner-unauthorized' });
    }
    return Object.freeze({ ...signed, branch: deepFreeze(body), authorized });
  } catch (error) {
    return Object.freeze({ valid: false, reason: error?.message ?? 'branch-verification-failed' });
  }
}

/**
 * Verified in-memory projection of branch descriptors and RealmBranchRefV1
 * head chains. Persistence is delegated to BranchStorage.js.
 */
export class RealmBranchDAG {
  constructor({ authorizeOwner, authorizeHead = null, requireAuthorization = true } = {}) {
    this._authorizeOwner = authorizeOwner;
    this._authorizeHead = authorizeHead;
    this._requireAuthorization = requireAuthorization !== false;
    this._branches = new Map();
    this._headChains = new Map();
    this._refsByHash = new Map();
    this._links = [];
  }

  get size() { return this._branches.size; }
  has(branchId) { return this._branches.has(String(branchId)); }
  get(branchId) { return this._branches.get(String(branchId)) ?? null; }
  head(branchId) {
    const chain = this._headChains.get(String(branchId)) ?? [];
    return chain.at(-1) ?? null;
  }

  async addBranch(branch) {
    if (this._requireAuthorization && typeof this._authorizeOwner !== 'function') {
      throw new Error('branch owner authorization callback is required');
    }
    const verified = await verifyRealmBranch(branch, { authorizeOwner: this._authorizeOwner });
    if (!verified.valid) throw new Error(`Realm branch rejected: ${verified.reason}`);
    const existing = this._branches.get(branch.branchId);
    if (existing) {
      if (canonicalize(existing) !== canonicalize(branch)) throw new Error('conflicting branch descriptor');
      return Object.freeze({ added: false, duplicate: true, branchId: branch.branchId });
    }
    if (branch.fork) {
      if (!this._branches.has(branch.fork.branchId)) throw new Error('branch fork parent is unknown');
      const parentRef = this._refsByHash.get(branch.fork.headRefHash);
      if (!parentRef || parentRef.branchId !== branch.fork.branchId) {
        throw new Error('branch fork references an unknown parent head');
      }
      this._links.push(link(branch.fork.branchId, branch.branchId));
      toposort([...this._branches.keys(), branch.branchId], this._links);
    }
    this._branches.set(branch.branchId, branch);
    this._headChains.set(branch.branchId, []);
    return Object.freeze({ added: true, duplicate: false, branchId: branch.branchId });
  }

  async appendHead(ref) {
    const branch = this._branches.get(String(ref?.branchId));
    if (!branch) throw new Error('cannot append a head for an unknown branch');
    if (ref.realmId !== branch.realmId) throw new Error('branch head belongs to another Realm');
    const refHash = await hashRealmBranchRef(ref);
    const known = this._refsByHash.get(refHash);
    if (known) {
      if (canonicalize(known) !== canonicalize(ref)) throw new Error('branch head hash collision');
      return Object.freeze({ appended: false, duplicate: true, refHash });
    }
    const chain = this._headChains.get(branch.branchId);
    const previous = chain.at(-1) ?? null;
    const verification = await verifyRealmBranchRef(ref, {
      previous,
      expectedSignerFingerprint: previous ? undefined : ref.signerFingerprint,
    });
    if (!verification.ok) throw new Error(`branch head rejected: ${verification.reason}`);
    const controllerMatch = ref.signerFingerprint === branch.signer.fingerprint;
    const delegated = typeof this._authorizeHead === 'function'
      && await this._authorizeHead(branch, ref.signerFingerprint, ref);
    if (!controllerMatch && !delegated) throw new Error('branch head signer is unauthorized');
    chain.push(ref);
    this._refsByHash.set(refHash, ref);
    return Object.freeze({ appended: true, duplicate: false, refHash });
  }

  order() { return Object.freeze(toposort(this._branches.keys(), this._links)); }
  isAncestor(ancestorBranchId, branchId) {
    return dependsOn(String(branchId), String(ancestorBranchId), this._links);
  }
  headHistory(branchId) {
    return Object.freeze([...(this._headChains.get(String(branchId)) ?? [])]);
  }
  branches() { return Object.freeze(this.order().map((id) => this._branches.get(id))); }
  snapshot() {
    return deepFreeze({
      format: 'realm-branch-dag-v1',
      branches: this.branches(),
      heads: Object.fromEntries(this.order().map((id) => [id, this.headHistory(id)])),
    });
  }
}

/** Public RealmBranchV1 contract. */
export const RealmBranchV1 = Object.freeze({
  format: REALM_BRANCH_FORMAT,
  schemaVersion: 1,
  create: createRealmBranch,
  verify: verifyRealmBranch,
});
