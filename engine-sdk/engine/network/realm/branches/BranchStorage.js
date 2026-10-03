// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * Bounded persistent storage adapter for branch metadata and offline queues.
 * Capsule/blob bytes remain in the shared RealmContentStore; this adapter never
 * duplicates content-addressed storage.
 */

import { canonicalize } from '../../../state/util/canonical.js';
import { assertRealmId, REALM_ID_TYPE } from '../addressing/RealmIds.js';
import { hashRealmBranchRef, verifyRealmBranchRef } from '../capsule/RealmBranchRef.js';
import { verifyRealmBranch } from './RealmBranch.js';

export const REALM_BRANCH_STORAGE_SCHEMA = 'realm-network.branch-storage-record';
export const REALM_BRANCH_STORAGE_VERSION = 2;
const DEFAULT_LEGACY_NAMESPACE = 'realm-network.branches.v1';
const MAX_DOCUMENT_BYTES = 4 * 1024 * 1024;
const MAX_BRANCHES_PER_REALM = 4096;
const MAX_HEADS_PER_BRANCH = 16384;
const encoder = new TextEncoder();

function keyPart(value) { return encodeURIComponent(String(value)); }

function assertBackend(backend) {
  if (!backend || typeof backend.getItem !== 'function'
    || typeof backend.setItem !== 'function' || typeof backend.removeItem !== 'function') {
    throw new TypeError('branch storage backend must implement getItem, setItem, and removeItem');
  }
  return backend;
}

function parseDocument(text, label) {
  if (text == null) return null;
  if (typeof text !== 'string' || encoder.encode(text).byteLength > MAX_DOCUMENT_BYTES) {
    throw new Error(`${label} exceeds the branch storage size limit`);
  }
  try { return JSON.parse(text); }
  catch (error) { throw new Error(`${label} is corrupt: ${error?.message ?? error}`); }
}

function branchStorageError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function currentNamespace(legacyNamespace) {
  return legacyNamespace.endsWith('.v1')
    ? `${legacyNamespace.slice(0, -3)}.v2`
    : `${legacyNamespace}.v2`;
}

export function prepareRealmBranchStorageRecord(record, label = 'branch storage record') {
  if (!record || typeof record !== 'object' || Array.isArray(record)
    || record.schema !== REALM_BRANCH_STORAGE_SCHEMA || !Number.isSafeInteger(record.schemaVersion)) {
    throw branchStorageError('CORRUPT_REALM_BRANCH_STORAGE', `${label} envelope is corrupt`);
  }
  if (record.schemaVersion > REALM_BRANCH_STORAGE_VERSION) {
    throw branchStorageError(
      'FUTURE_REALM_BRANCH_STORAGE_VERSION',
      `${label} schema version ${record.schemaVersion} is newer than supported version ${REALM_BRANCH_STORAGE_VERSION}`,
    );
  }
  if (record.schemaVersion !== REALM_BRANCH_STORAGE_VERSION || typeof record.legacySnapshot !== 'string'
    || !Object.prototype.hasOwnProperty.call(record, 'value')) {
    throw branchStorageError('CORRUPT_REALM_BRANCH_STORAGE', `${label} envelope version is unsupported`);
  }
  let expectedSnapshot;
  try { expectedSnapshot = canonicalize(record.value); }
  catch (_) { throw branchStorageError('CORRUPT_REALM_BRANCH_STORAGE', `${label} payload is corrupt`); }
  if (record.legacySnapshot !== expectedSnapshot) {
    throw branchStorageError('CORRUPT_REALM_BRANCH_STORAGE', `${label} payload does not match its legacy snapshot`);
  }
  return record;
}

/** LocalStorage-compatible persistent key/value adapter. */
export class RealmBranchStorage {
  constructor({ backend = globalThis.localStorage, namespace = DEFAULT_LEGACY_NAMESPACE } = {}) {
    this._backend = assertBackend(backend);
    this._legacyNamespace = String(namespace || DEFAULT_LEGACY_NAMESPACE);
    this._namespace = currentNamespace(this._legacyNamespace);
  }

  _key(kind, ...parts) {
    return [this._namespace, kind, ...parts.map(keyPart)].join(':');
  }

  _legacyKey(key) {
    const prefix = `${this._namespace}:`;
    if (!key.startsWith(prefix)) throw new Error('branch storage key is outside the current namespace');
    return `${this._legacyNamespace}:${key.slice(prefix.length)}`;
  }

  async _inspect(key, label) {
    const legacyKey = this._legacyKey(key);
    const [currentText, legacyText] = await Promise.all([
      this._backend.getItem(key),
      this._backend.getItem(legacyKey),
    ]);
    const legacy = parseDocument(legacyText, `${label} legacy-v1`);
    let current = null;
    if (currentText != null) {
      const parsed = parseDocument(currentText, `${label} current-v2`);
      current = prepareRealmBranchStorageRecord(parsed, label);
      if (encoder.encode(current.legacySnapshot).byteLength > MAX_DOCUMENT_BYTES) {
        throw branchStorageError('CORRUPT_REALM_BRANCH_STORAGE', `${label} legacy snapshot exceeds the size limit`);
      }
    }
    return { key, legacyKey, current, legacy, legacyText };
  }

  async _read(key, label) {
    const state = await this._inspect(key, label);
    if (state.current && state.legacyText != null && state.current.legacySnapshot !== state.legacyText) {
      return state.legacy;
    }
    return state.current?.value ?? state.legacy;
  }

  async _write(key, value, label) {
    const state = await this._inspect(key, label);
    const legacyText = canonicalize(value);
    const currentText = canonicalize({
      schema: REALM_BRANCH_STORAGE_SCHEMA,
      schemaVersion: REALM_BRANCH_STORAGE_VERSION,
      value,
      legacySnapshot: legacyText,
    });
    if (encoder.encode(legacyText).byteLength > MAX_DOCUMENT_BYTES
      || encoder.encode(currentText).byteLength > MAX_DOCUMENT_BYTES) {
      throw new Error(`${label} exceeds the branch storage size limit`);
    }
    await this._backend.setItem(state.legacyKey, legacyText);
    try {
      await this._backend.setItem(key, currentText);
    } catch (error) {
      try {
        if (state.legacyText == null) await this._backend.removeItem(state.legacyKey);
        else await this._backend.setItem(state.legacyKey, state.legacyText);
      } catch (_) {}
      throw error;
    }
  }

  async putBranch(branch, options = {}) {
    const verification = await verifyRealmBranch(branch, {
      authorizeOwner: options.authorizeOwner,
    });
    if (!verification.valid) throw new Error(`cannot persist invalid branch: ${verification.reason}`);
    const indexKey = this._key('realm-index', branch.realmId);
    const index = await this._read(indexKey, 'branch index') ?? [];
    if (!Array.isArray(index)) throw new Error('branch index is corrupt');
    if (!index.includes(branch.branchId)) {
      if (index.length >= MAX_BRANCHES_PER_REALM) throw new Error('branch index limit reached');
      index.push(branch.branchId);
      index.sort();
    }
    await this._write(this._key('branch', branch.realmId, branch.branchId), branch, 'branch descriptor');
    await this._write(indexKey, index, 'branch index');
    return branch;
  }

  async getBranch(realmId, branchId, options = {}) {
    assertRealmId(realmId, REALM_ID_TYPE.REALM, 'Realm ID');
    assertRealmId(branchId, REALM_ID_TYPE.BRANCH, 'Branch ID');
    const branch = await this._read(this._key('branch', realmId, branchId), 'branch descriptor');
    if (!branch) return null;
    const verification = await verifyRealmBranch(branch, { authorizeOwner: options.authorizeOwner });
    if (!verification.valid) throw new Error(`persisted branch is invalid: ${verification.reason}`);
    return branch;
  }

  async listBranches(realmId, options = {}) {
    assertRealmId(realmId, REALM_ID_TYPE.REALM, 'Realm ID');
    const index = await this._read(this._key('realm-index', realmId), 'branch index') ?? [];
    if (!Array.isArray(index) || index.length > MAX_BRANCHES_PER_REALM) throw new Error('branch index is corrupt');
    const branches = [];
    for (const branchId of index) {
      const branch = await this.getBranch(realmId, branchId, options);
      if (!branch) throw new Error(`branch index references missing branch ${branchId}`);
      branches.push(branch);
    }
    return Object.freeze(branches);
  }

  async appendHead(ref, options = {}) {
    const branch = await this.getBranch(ref?.realmId, ref?.branchId, {
      authorizeOwner: options.authorizeOwner,
    });
    if (!branch) throw new Error('cannot persist a head for an unknown branch');
    const key = this._key('heads', ref.realmId, ref.branchId);
    const history = await this._read(key, 'branch head history') ?? [];
    if (!Array.isArray(history) || history.length > MAX_HEADS_PER_BRANCH) throw new Error('branch head history is corrupt');
    const refHash = await hashRealmBranchRef(ref);
    for (const known of history) {
      if (await hashRealmBranchRef(known) === refHash) return Object.freeze({ appended: false, refHash });
    }
    const previous = history.at(-1) ?? null;
    const verification = await verifyRealmBranchRef(ref, { previous });
    if (!verification.ok) throw new Error(`cannot persist invalid branch head: ${verification.reason}`);
    const controllerMatch = ref.signerFingerprint === branch.signer.fingerprint;
    const delegated = typeof options.authorizeHead === 'function'
      && await options.authorizeHead(branch, ref.signerFingerprint, ref);
    if (!controllerMatch && !delegated) throw new Error('branch head signer is unauthorized');
    if (history.length >= MAX_HEADS_PER_BRANCH) throw new Error('branch head history limit reached');
    history.push(ref);
    await this._write(key, history, 'branch head history');
    return Object.freeze({ appended: true, refHash });
  }

  async getHeadHistory(realmId, branchId) {
    assertRealmId(realmId, REALM_ID_TYPE.REALM, 'Realm ID');
    assertRealmId(branchId, REALM_ID_TYPE.BRANCH, 'Branch ID');
    const history = await this._read(this._key('heads', realmId, branchId), 'branch head history') ?? [];
    if (!Array.isArray(history) || history.length > MAX_HEADS_PER_BRANCH) throw new Error('branch head history is corrupt');
    let previous = null;
    for (const ref of history) {
      const verification = await verifyRealmBranchRef(ref, { previous });
      if (!verification.ok) throw new Error(`persisted branch head is invalid: ${verification.reason}`);
      previous = ref;
    }
    return Object.freeze(history);
  }

  async saveQueue(realmId, branchId, snapshot) {
    assertRealmId(realmId, REALM_ID_TYPE.REALM, 'Realm ID');
    assertRealmId(branchId, REALM_ID_TYPE.BRANCH, 'Branch ID');
    await this._write(this._key('queue', realmId, branchId), snapshot, 'offline operation queue');
  }

  async loadQueue(realmId, branchId) {
    assertRealmId(realmId, REALM_ID_TYPE.REALM, 'Realm ID');
    assertRealmId(branchId, REALM_ID_TYPE.BRANCH, 'Branch ID');
    return this._read(this._key('queue', realmId, branchId), 'offline operation queue');
  }

  async removeQueue(realmId, branchId) {
    assertRealmId(realmId, REALM_ID_TYPE.REALM, 'Realm ID');
    assertRealmId(branchId, REALM_ID_TYPE.BRANCH, 'Branch ID');
    const key = this._key('queue', realmId, branchId);
    const state = await this._inspect(key, 'offline operation queue');
    await this._backend.removeItem(state.legacyKey);
    await this._backend.removeItem(key);
  }
}
