// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/** Persistent, causal, resumable queue for signed offline Chronicle events. */

import { canonicalize } from '../../../state/util/canonical.js';
import { assertRealmId, REALM_ID_TYPE } from '../addressing/RealmIds.js';
import { verifyChronicleEvent } from '../chronicle/RealmChronicle.js';
import { deepFreeze } from '../capsule/RealmCapsuleSchema.js';

export const OFFLINE_QUEUE_FORMAT = 'realm-offline-operation-queue-v1';
export const OFFLINE_OPERATION_STATUS = Object.freeze({
  PENDING: 'pending',
  TRANSMITTING: 'transmitting',
  ACKNOWLEDGED: 'acknowledged',
});

const SECURE_ID = /^sha256:256:[0-9a-f]{64}$/;
const STATUSES = new Set(Object.values(OFFLINE_OPERATION_STATUS));
const MAX_ENTRIES = 4096;
const MAX_KNOWN_PARENTS = 32768;
const MAX_ACK_TEXT = 512;

function safeInteger(value, name, minimum = 0) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < minimum) throw new TypeError(`${name} is invalid`);
  return number;
}

function eventId(value, name = 'Chronicle event ID') {
  const id = String(value ?? '');
  if (!SECURE_ID.test(id)) throw new TypeError(`${name} is invalid`);
  return id;
}

function normalizeAck(value, expectedEventId) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('operation acknowledgement is invalid');
  const acknowledgedEventId = eventId(value.eventId, 'acknowledged event ID');
  if (acknowledgedEventId !== expectedEventId) throw new Error('acknowledgement event ID mismatch');
  if (value.accepted !== true) throw new Error('acknowledgement does not accept the event');
  const peerId = value.peerId == null ? null : String(value.peerId);
  if (peerId !== null && (!peerId || peerId.length > MAX_ACK_TEXT)) throw new TypeError('acknowledgement peer ID is invalid');
  return Object.freeze({
    eventId: acknowledgedEventId,
    accepted: true,
    acknowledgedAt: safeInteger(value.acknowledgedAt ?? Date.now(), 'acknowledgedAt'),
    peerId,
    remoteHead: value.remoteHead == null ? null : eventId(value.remoteHead, 'acknowledgement remote head'),
  });
}

function snapshotEntry(entry) {
  return {
    event: entry.event,
    status: entry.status,
    attempts: entry.attempts,
    enqueuedAt: entry.enqueuedAt,
    lastAttemptAt: entry.lastAttemptAt,
    lastError: entry.lastError,
    acknowledgement: entry.acknowledgement,
  };
}

export class OfflineOperationQueue {
  constructor({ storage, realmId, branchId, now = () => Date.now() } = {}) {
    if (!storage || typeof storage.loadQueue !== 'function' || typeof storage.saveQueue !== 'function') {
      throw new TypeError('offline queue requires a branch storage adapter');
    }
    this.storage = storage;
    this.realmId = assertRealmId(realmId, REALM_ID_TYPE.REALM, 'Realm ID');
    this.branchId = assertRealmId(branchId, REALM_ID_TYPE.BRANCH, 'Branch ID');
    this._now = now;
    this._entries = new Map();
    this._knownParents = new Set();
    this._revision = 0;
    this._opened = false;
  }

  static async open(options = {}) {
    const queue = new OfflineOperationQueue(options);
    await queue._restore(options.knownParentIds ?? []);
    return queue;
  }

  get size() { return this._entries.size; }
  get revision() { return this._revision; }

  async _restore(initialParents) {
    for (const id of initialParents) this._knownParents.add(eventId(id));
    const stored = await this.storage.loadQueue(this.realmId, this.branchId);
    if (stored) {
      if (stored.format !== OFFLINE_QUEUE_FORMAT || stored.schemaVersion !== 1
        || stored.realmId !== this.realmId || stored.branchId !== this.branchId) {
        throw new Error('persisted offline queue identity is invalid');
      }
      this._revision = safeInteger(stored.revision, 'offline queue revision');
      if (!Array.isArray(stored.knownParentIds) || stored.knownParentIds.length > MAX_KNOWN_PARENTS) {
        throw new Error('persisted offline queue parents are invalid');
      }
      for (const id of stored.knownParentIds) this._knownParents.add(eventId(id));
      if (!Array.isArray(stored.entries) || stored.entries.length > MAX_ENTRIES) {
        throw new Error('persisted offline queue entries are invalid');
      }
      for (const value of stored.entries) {
        const verification = await verifyChronicleEvent(value?.event);
        if (!verification.valid) throw new Error(`persisted offline event is invalid: ${verification.reason}`);
        const event = value.event;
        if (event.realmId !== this.realmId || event.branchId !== this.branchId) {
          throw new Error('persisted offline event belongs to another branch');
        }
        if (event.sequence > 0 && event.parents.length === 0) {
          throw new Error('persisted non-genesis offline event has no Chronicle parent');
        }
        if (this._entries.has(event.eventId)) throw new Error('persisted offline queue contains a duplicate event');
        const status = String(value.status ?? '');
        if (!STATUSES.has(status)) throw new Error('persisted offline event status is invalid');
        const acknowledgement = value.acknowledgement == null
          ? null
          : normalizeAck(value.acknowledgement, event.eventId);
        if (status === OFFLINE_OPERATION_STATUS.ACKNOWLEDGED && !acknowledgement) {
          throw new Error('acknowledged offline event has no acknowledgement');
        }
        this._entries.set(event.eventId, {
          event,
          status: status === OFFLINE_OPERATION_STATUS.TRANSMITTING
            ? OFFLINE_OPERATION_STATUS.PENDING
            : status,
          attempts: safeInteger(value.attempts, 'offline event attempts'),
          enqueuedAt: safeInteger(value.enqueuedAt, 'offline event enqueuedAt'),
          lastAttemptAt: value.lastAttemptAt == null ? null : safeInteger(value.lastAttemptAt, 'offline event lastAttemptAt'),
          lastError: status === OFFLINE_OPERATION_STATUS.TRANSMITTING
            ? 'transport-interrupted-before-acknowledgement'
            : (value.lastError == null ? null : String(value.lastError).slice(0, MAX_ACK_TEXT)),
          acknowledgement,
        });
        if (acknowledgement) this._knownParents.add(event.eventId);
      }
    }
    this._opened = true;
    await this._persist();
  }

  _assertOpen() {
    if (!this._opened) throw new Error('offline operation queue is not open');
  }

  snapshot() {
    this._assertOpen();
    return deepFreeze({
      format: OFFLINE_QUEUE_FORMAT,
      schemaVersion: 1,
      realmId: this.realmId,
      branchId: this.branchId,
      revision: this._revision,
      knownParentIds: [...this._knownParents].sort(),
      entries: [...this._entries.values()]
        .sort((left, right) => left.event.sequence - right.event.sequence
          || left.event.eventId.localeCompare(right.event.eventId))
        .map(snapshotEntry),
    });
  }

  async _persist() {
    this._revision += 1;
    await this.storage.saveQueue(this.realmId, this.branchId, this.snapshot());
  }

  get(id) {
    this._assertOpen();
    const entry = this._entries.get(String(id));
    return entry ? deepFreeze(snapshotEntry(entry)) : null;
  }

  pending() {
    this._assertOpen();
    return Object.freeze([...this._entries.values()]
      .filter((entry) => entry.status === OFFLINE_OPERATION_STATUS.PENDING)
      .map((entry) => deepFreeze(snapshotEntry(entry))));
  }

  ready() {
    this._assertOpen();
    return Object.freeze(this.pending().filter((entry) => entry.event.parents.every((parentId) => {
      if (this._knownParents.has(parentId)) return true;
      return this._entries.get(parentId)?.status === OFFLINE_OPERATION_STATUS.ACKNOWLEDGED;
    })));
  }

  async enqueue(event, { enqueuedAt = this._now() } = {}) {
    this._assertOpen();
    const verification = await verifyChronicleEvent(event);
    if (!verification.valid) throw new Error(`offline event rejected: ${verification.reason}`);
    if (event.realmId !== this.realmId || event.branchId !== this.branchId) {
      throw new Error('offline event belongs to another Realm or branch');
    }
    if (event.sequence > 0 && event.parents.length === 0) {
      throw new Error('non-genesis offline event requires a Chronicle parent');
    }
    const existing = this._entries.get(event.eventId);
    if (existing) {
      if (canonicalize(existing.event) !== canonicalize(event)) throw new Error('offline event ID collision');
      return Object.freeze({ enqueued: false, duplicate: true, eventId: event.eventId });
    }
    if (this._entries.size >= MAX_ENTRIES) throw new Error('offline operation queue limit reached');
    this._entries.set(event.eventId, {
      event,
      status: OFFLINE_OPERATION_STATUS.PENDING,
      attempts: 0,
      enqueuedAt: safeInteger(enqueuedAt, 'offline event enqueuedAt'),
      lastAttemptAt: null,
      lastError: null,
      acknowledgement: null,
    });
    await this._persist();
    return Object.freeze({ enqueued: true, duplicate: false, eventId: event.eventId });
  }

  async markParentKnown(id) {
    this._assertOpen();
    const normalized = eventId(id);
    if (this._knownParents.size >= MAX_KNOWN_PARENTS && !this._knownParents.has(normalized)) {
      throw new Error('known Chronicle parent limit reached');
    }
    this._knownParents.add(normalized);
    await this._persist();
  }

  async acknowledge(id, acknowledgement) {
    this._assertOpen();
    const normalized = eventId(id);
    const entry = this._entries.get(normalized);
    if (!entry) throw new Error('cannot acknowledge an unknown offline event');
    const ack = normalizeAck(acknowledgement, normalized);
    entry.status = OFFLINE_OPERATION_STATUS.ACKNOWLEDGED;
    entry.acknowledgement = ack;
    entry.lastError = null;
    this._knownParents.add(normalized);
    await this._persist();
    return deepFreeze(snapshotEntry(entry));
  }

  /**
   * Deliver every currently causal-ready event at least once. A missing or
   * failed acknowledgement returns the event to pending for a later reconnect.
   */
  async drain(deliver, { maxBatch = 128 } = {}) {
    this._assertOpen();
    if (typeof deliver !== 'function') throw new TypeError('offline queue deliver callback is required');
    const limit = safeInteger(maxBatch, 'offline queue maxBatch', 1);
    const attempted = new Set();
    let delivered = 0;
    let deferred = 0;
    while (attempted.size < limit) {
      const entry = this.ready().find((candidate) => !attempted.has(candidate.event.eventId));
      if (!entry) break;
      const mutable = this._entries.get(entry.event.eventId);
      attempted.add(entry.event.eventId);
      mutable.status = OFFLINE_OPERATION_STATUS.TRANSMITTING;
      mutable.attempts += 1;
      mutable.lastAttemptAt = safeInteger(this._now(), 'offline event lastAttemptAt');
      mutable.lastError = null;
      await this._persist();
      try {
        const result = await deliver(mutable.event, Object.freeze({
          attempt: mutable.attempts,
          chronicleParents: mutable.event.parents,
        }));
        const ack = result?.acknowledgement ?? result?.ack ?? result;
        await this.acknowledge(mutable.event.eventId, ack);
        delivered += 1;
      } catch (error) {
        mutable.status = OFFLINE_OPERATION_STATUS.PENDING;
        mutable.lastError = String(error?.message ?? error).slice(0, MAX_ACK_TEXT);
        await this._persist();
        deferred += 1;
      }
    }
    return Object.freeze({ delivered, deferred, attempted: attempted.size, remaining: this.pending().length });
  }

  async pruneAcknowledged({ retain = 0 } = {}) {
    this._assertOpen();
    const keep = safeInteger(retain, 'offline queue retain');
    const acknowledged = [...this._entries.values()]
      .filter((entry) => entry.status === OFFLINE_OPERATION_STATUS.ACKNOWLEDGED)
      .sort((left, right) => right.event.sequence - left.event.sequence
        || right.event.eventId.localeCompare(left.event.eventId));
    for (const entry of acknowledged.slice(keep)) {
      this._knownParents.add(entry.event.eventId);
      this._entries.delete(entry.event.eventId);
    }
    await this._persist();
    return acknowledged.length - Math.min(acknowledged.length, keep);
  }
}
