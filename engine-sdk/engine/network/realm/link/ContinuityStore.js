// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

// Storage-agnostic continuity records for reconnect and verified transfer
// resume. Raw reconnect tokens are deliberately rejected: callers persist an
// opaque credential only after sealing it with the OS/profile storage layer.

export const CONTINUITY_SCHEMA = 'ContinuityV1';
export const TRANSFER_STATE = Object.freeze({
  PENDING: 'pending',
  ACTIVE: 'active',
  COMPLETE: 'complete',
  FAILED: 'failed',
  CANCELLED: 'cancelled',
});

const MAX_TRANSFERS = 4096;
const VALID_TRANSFER_STATES = new Set(Object.values(TRANSFER_STATE));

function clone(value) {
  return value == null ? value : structuredClone(value);
}

function boundedId(value, name, { nullable = false } = {}) {
  if (value == null && nullable) return null;
  const id = String(value ?? '').trim();
  if (!id || id.length > 1024) throw new TypeError(`${name} must be a non-empty bounded string`);
  return id;
}

function validateTransfer(transfer) {
  if (!transfer || typeof transfer !== 'object' || Array.isArray(transfer)) throw new TypeError('transfer must be an object');
  const state = transfer.state ?? TRANSFER_STATE.PENDING;
  if (!VALID_TRANSFER_STATES.has(state)) throw new TypeError(`invalid transfer state: ${state}`);
  const receivedBytes = Number(transfer.receivedBytes ?? 0);
  const totalBytes = transfer.totalBytes == null ? null : Number(transfer.totalBytes);
  if (!Number.isSafeInteger(receivedBytes) || receivedBytes < 0) throw new RangeError('receivedBytes must be a non-negative safe integer');
  if (totalBytes != null && (!Number.isSafeInteger(totalBytes) || totalBytes < 0 || receivedBytes > totalBytes)) {
    throw new RangeError('totalBytes must be a safe integer greater than or equal to receivedBytes');
  }
  if (state === TRANSFER_STATE.COMPLETE && totalBytes != null && receivedBytes !== totalBytes) {
    throw new RangeError('complete transfer byte counts must match');
  }
  return Object.freeze({
    transferId: boundedId(transfer.transferId, 'transferId'),
    capsuleRoot: boundedId(transfer.capsuleRoot, 'capsuleRoot', { nullable: true }),
    contentId: boundedId(transfer.contentId, 'contentId', { nullable: true }),
    chunkId: boundedId(transfer.chunkId, 'chunkId', { nullable: true }),
    receivedBytes,
    totalBytes,
    state,
    updatedAt: Number.isFinite(transfer.updatedAt) ? transfer.updatedAt : Date.now(),
    errorCode: transfer.errorCode == null ? null : boundedId(transfer.errorCode, 'errorCode'),
  });
}

export function validateContinuityRecord(record) {
  if (!record || typeof record !== 'object' || Array.isArray(record)) throw new TypeError('continuity record must be an object');
  if ('reconnectToken' in record || 'rawReconnectToken' in record) {
    throw new TypeError('continuity records reject raw reconnect tokens; provide sealedReconnectCredential');
  }
  if (record.schema !== CONTINUITY_SCHEMA || record.version !== 1) throw new TypeError('unsupported continuity record schema');
  if (!Number.isSafeInteger(record.sessionEpoch) || record.sessionEpoch < 0) throw new RangeError('sessionEpoch must be non-negative');
  if (!Number.isSafeInteger(record.lastSentSequence) || record.lastSentSequence < 0) throw new RangeError('lastSentSequence must be non-negative');
  const remoteMaxSequence = Number(record.remoteMaxSequence ?? 0);
  if (!Number.isSafeInteger(remoteMaxSequence) || remoteMaxSequence < 0) throw new RangeError('remoteMaxSequence must be non-negative');
  const remoteSeenInput = record.remoteSeenSequences ?? [];
  if (!Array.isArray(remoteSeenInput) || remoteSeenInput.length > 4096) {
    throw new RangeError('remoteSeenSequences must be a bounded array');
  }
  const remoteSeenSequences = [...new Set(remoteSeenInput.map(Number))];
  if (remoteSeenSequences.some((sequence) => !Number.isSafeInteger(sequence) || sequence <= 0 || sequence > remoteMaxSequence)) {
    throw new RangeError('remoteSeenSequences contains an invalid sequence');
  }
  if (!Array.isArray(record.transfers) || record.transfers.length > MAX_TRANSFERS) throw new RangeError('invalid continuity transfer collection');
  const transfers = record.transfers.map(validateTransfer);
  const ids = new Set();
  for (const transfer of transfers) {
    if (ids.has(transfer.transferId)) throw new TypeError(`duplicate transferId: ${transfer.transferId}`);
    ids.add(transfer.transferId);
  }
  return Object.freeze({
    schema: CONTINUITY_SCHEMA,
    version: 1,
    linkId: boundedId(record.linkId, 'linkId'),
    realmId: boundedId(record.realmId, 'realmId'),
    branchId: boundedId(record.branchId, 'branchId'),
    localPeerId: boundedId(record.localPeerId, 'localPeerId'),
    remotePeerId: boundedId(record.remotePeerId, 'remotePeerId', { nullable: true }),
    sessionEpoch: record.sessionEpoch,
    lastSentSequence: record.lastSentSequence,
    remoteMaxSequence,
    remoteSeenSequences: Object.freeze(remoteSeenSequences.sort((a, b) => a - b)),
    sealedReconnectCredential: record.sealedReconnectCredential == null ? null : clone(record.sealedReconnectCredential),
    peerTicket: record.peerTicket == null ? null : clone(record.peerTicket),
    routeHints: Object.freeze(Array.isArray(record.routeHints) ? record.routeHints.slice(0, 32).map(String) : []),
    transfers: Object.freeze(transfers),
    updatedAt: Number.isFinite(record.updatedAt) ? record.updatedAt : Date.now(),
  });
}

export function createContinuityRecord({
  linkId,
  realmId,
  branchId,
  localPeerId,
  remotePeerId = null,
  sessionEpoch = 0,
  lastSentSequence = 0,
  remoteMaxSequence = 0,
  remoteSeenSequences = [],
  sealedReconnectCredential = null,
  peerTicket = null,
  routeHints = [],
  transfers = [],
  updatedAt = Date.now(),
} = {}) {
  return validateContinuityRecord({
    schema: CONTINUITY_SCHEMA,
    version: 1,
    linkId,
    realmId,
    branchId,
    localPeerId,
    remotePeerId,
    sessionEpoch,
    lastSentSequence,
    remoteMaxSequence,
    remoteSeenSequences,
    sealedReconnectCredential,
    peerTicket,
    routeHints,
    transfers,
    updatedAt,
  });
}

export function continuityStorageKey({ realmId, branchId, linkId }) {
  return `realm-continuity:${encodeURIComponent(realmId)}:${encodeURIComponent(branchId)}:${encodeURIComponent(linkId)}`;
}

/** In-memory adapter for tests and ephemeral sessions; durable OS storage is injected with the same interface. */
export function createMemoryContinuityAdapter() {
  const records = new Map();
  return {
    async load(key) { return clone(records.get(key) ?? null); },
    async save(key, value) { records.set(key, clone(value)); },
    async remove(key) { return records.delete(key); },
    async listKeys() { return [...records.keys()]; },
  };
}

export function createContinuityStore({ adapter = createMemoryContinuityAdapter(), now = () => Date.now(), logger = () => {} } = {}) {
  if (!adapter || typeof adapter.load !== 'function' || typeof adapter.save !== 'function' || typeof adapter.remove !== 'function') {
    throw new TypeError('continuity store requires load/save/remove adapter methods');
  }
  if (typeof now !== 'function' || typeof logger !== 'function') throw new TypeError('invalid continuity store hooks');
  return { adapter, now, logger };
}

function emit(store, event, record, level = 'debug') {
  store.logger({
    component: 'realm-continuity',
    event,
    level,
    at: store.now(),
    linkId: record?.linkId ?? null,
    realmId: record?.realmId ?? null,
    branchId: record?.branchId ?? null,
  });
}

export async function saveContinuity(store, record) {
  const checked = validateContinuityRecord({ ...record, updatedAt: store.now() });
  const key = continuityStorageKey(checked);
  emit(store, 'save.enter', checked);
  await store.adapter.save(key, checked);
  emit(store, 'save.exit', checked);
  return checked;
}

export async function loadContinuity(store, ids) {
  const key = continuityStorageKey(ids);
  const raw = await store.adapter.load(key);
  if (raw == null) return null;
  try {
    const checked = validateContinuityRecord(raw);
    emit(store, 'load.valid', checked);
    return checked;
  } catch (error) {
    store.logger({
      component: 'realm-continuity',
      event: 'load.rejected',
      level: 'error',
      at: store.now(),
      linkId: ids.linkId,
      realmId: ids.realmId,
      branchId: ids.branchId,
      reason: error?.message ?? 'invalid-record',
    });
    return null;
  }
}

export async function removeContinuity(store, ids) {
  return store.adapter.remove(continuityStorageKey(ids));
}

/** Update one transfer monotonically; completed/cancelled records cannot be reopened. */
export function updateTransferProgress(record, update, now = Date.now()) {
  const checked = validateContinuityRecord(record);
  const nextTransfer = validateTransfer({ ...update, updatedAt: now });
  const transfers = checked.transfers.map((item) => ({ ...item }));
  const index = transfers.findIndex((item) => item.transferId === nextTransfer.transferId);
  if (index >= 0) {
    const prior = transfers[index];
    if (nextTransfer.receivedBytes < prior.receivedBytes) throw new RangeError('transfer progress cannot move backwards');
    if (prior.totalBytes != null && nextTransfer.totalBytes != null && prior.totalBytes !== nextTransfer.totalBytes) {
      throw new RangeError('transfer totalBytes cannot change');
    }
    if ([TRANSFER_STATE.COMPLETE, TRANSFER_STATE.CANCELLED].includes(prior.state) && nextTransfer.state !== prior.state) {
      throw new Error(`terminal transfer cannot transition from ${prior.state} to ${nextTransfer.state}`);
    }
    transfers[index] = nextTransfer;
  } else {
    if (transfers.length >= MAX_TRANSFERS) throw new RangeError('continuity transfer limit reached');
    transfers.push(nextTransfer);
  }
  return validateContinuityRecord({ ...checked, transfers, updatedAt: now });
}
