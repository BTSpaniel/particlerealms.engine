// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

// state/transaction/Idempotency.js — replay protection (spec rule 21).
//
// Every potentially duplicated operation carries an idempotency key
// (`actor:task:operation`). The default registry preserves canonical at-most-
// once receipts without eviction for CommitCoordinator and other durable
// callers. A bounded TTL/LRU policy is available only by explicit opt-in for
// process-local replay caches whose mutation safety lives in canonical state or
// a separate durable dispatch fence.

export const IDEMPOTENCY_REPLAY_MAX_ENTRIES = 512;
export const IDEMPOTENCY_REPLAY_TTL_MS = 5 * 60 * 1000;

const IDEMPOTENCY_REPLAY_MAX_ENTRIES_LIMIT = 4096;
const IDEMPOTENCY_REPLAY_TTL_MS_LIMIT = 24 * 60 * 60 * 1000;
const IDEMPOTENCY_REPLAY_MAX_BYTES_LIMIT = 256 * 1024 * 1024;
const UTF8_ENCODER = new TextEncoder();

export class IdempotencyRegistry {
  constructor({
    maxEntries = null,
    ttlMs = null,
    maxBytes = null,
    clock = () => Date.now(),
  } = {}) {
    if ((maxEntries == null) !== (ttlMs == null)) {
      throw new TypeError('IdempotencyRegistry bounded policy requires both maxEntries and ttlMs');
    }
    this._bounded = maxEntries != null;
    this._maxEntries = this._bounded
      ? boundedInteger(maxEntries, 'IdempotencyRegistry maxEntries', 1, IDEMPOTENCY_REPLAY_MAX_ENTRIES_LIMIT)
      : null;
    this._ttlMs = this._bounded
      ? boundedInteger(ttlMs, 'IdempotencyRegistry ttlMs', 1, IDEMPOTENCY_REPLAY_TTL_MS_LIMIT)
      : null;
    if (maxBytes != null && !this._bounded) {
      throw new TypeError('IdempotencyRegistry maxBytes requires a bounded policy');
    }
    this._maxBytes = maxBytes == null
      ? null
      : boundedInteger(maxBytes, 'IdempotencyRegistry maxBytes', 1, IDEMPOTENCY_REPLAY_MAX_BYTES_LIMIT);
    this._retainedBytes = 0;
    if (typeof clock !== 'function') throw new TypeError('IdempotencyRegistry clock must be a function');
    this._clock = clock;
    this._seen = new Map(); // key → { transactionID, receipt, expiresAt }
  }

  /** Has this idempotency key already been committed? */
  has(key) { return this._lookup(key) !== null; }

  /** Recorded result for a key, or null. */
  get(key) {
    const entry = this._lookup(key);
    return entry ? replayProjection(entry) : null;
  }

  /**
   * Record the first result for a key. No-op (returns existing) if already set.
   * Default registries retain that replay indefinitely; explicitly bounded
   * registries guarantee it only inside their configured replay window.
   * @returns {{ transactionID:string, receipt:object, replayed:boolean }}
   */
  record(key, transactionID, receipt) {
    if (key == null) return { transactionID, receipt, replayed: false };
    const k = String(key);
    const now = this._bounded ? this._now() : null;
    if (this._bounded) this.sweep(now);
    const prior = this._seen.get(k);
    if (prior) {
      this._touch(k, prior);
      return { ...replayProjection(prior), replayed: true };
    }
    const normalizedTransactionID = String(transactionID);
    const boundedSnapshot = this._bounded ? jsonReceiptSnapshot(receipt) : null;
    if (this._bounded && !boundedSnapshot.ok) {
      return { transactionID: normalizedTransactionID, receipt, replayed: false };
    }
    const retainedReceipt = this._bounded ? boundedSnapshot.value : receipt;
    const retainedBytes = this._maxBytes == null
      ? null
      : replayEntryBytes(k, normalizedTransactionID, retainedReceipt);
    // Oversized or non-serializable process-local receipts still settle every
    // current single-flight waiter, but are deliberately not retained for a
    // future replay. Durable mutation authority lives outside this cache.
    if (this._maxBytes != null && (retainedBytes == null || retainedBytes > this._maxBytes)) {
      return { transactionID: normalizedTransactionID, receipt: retainedReceipt, replayed: false };
    }
    const entry = {
      transactionID: normalizedTransactionID,
      receipt: retainedReceipt,
      expiresAt: this._bounded ? now + this._ttlMs : null,
      retainedBytes,
    };
    this._seen.set(k, entry);
    if (retainedBytes != null) this._retainedBytes += retainedBytes;
    this._evictOverflow();
    return { ...replayProjection(entry), replayed: false };
  }

  /** Remove every expired settled receipt and return the number removed. */
  sweep(now = null) {
    if (!this._bounded) return 0;
    const current = now == null ? this._now() : finiteNumber(now, 'IdempotencyRegistry sweep time');
    let removed = 0;
    for (const [key, entry] of this._seen) {
      if (current < entry.expiresAt) continue;
      this._delete(key, entry);
      removed += 1;
    }
    return removed;
  }

  /** Content-free cache diagnostics. Keys and receipts are never projected. */
  metadata() {
    return Object.freeze({
      size: this.size,
      bounded: this._bounded,
      maxEntries: this._maxEntries,
      ttlMs: this._ttlMs,
      maxBytes: this._maxBytes,
      retainedBytes: this._maxBytes == null ? null : this._retainedBytes,
    });
  }

  get size() {
    this.sweep();
    return this._seen.size;
  }

  _lookup(key) {
    if (key == null) return null;
    const k = String(key);
    const entry = this._seen.get(k);
    if (!entry) return null;
    if (this._bounded && this._now() >= entry.expiresAt) {
      this._delete(k, entry);
      return null;
    }
    this._touch(k, entry);
    return entry;
  }

  _touch(key, entry) {
    this._seen.delete(key);
    this._seen.set(key, entry);
  }

  _evictOverflow() {
    if (!this._bounded) return;
    while (this._seen.size > this._maxEntries
      || (this._maxBytes != null && this._retainedBytes > this._maxBytes)) {
      const oldest = this._seen.keys().next().value;
      this._delete(oldest, this._seen.get(oldest));
    }
  }

  _delete(key, entry = this._seen.get(key)) {
    if (!this._seen.delete(key)) return false;
    if (entry?.retainedBytes != null) {
      this._retainedBytes = Math.max(0, this._retainedBytes - entry.retainedBytes);
    }
    return true;
  }

  _now() {
    const value = Number(this._clock());
    if (!Number.isFinite(value)) throw new TypeError('IdempotencyRegistry clock returned a non-finite value');
    return value;
  }
}

function replayProjection(entry) {
  return { transactionID: entry.transactionID, receipt: entry.receipt };
}

function replayEntryBytes(key, transactionID, receipt) {
  try {
    return UTF8_ENCODER.encode(JSON.stringify({ key, transactionID, receipt })).byteLength;
  } catch {
    return null;
  }
}

function jsonReceiptSnapshot(receipt) {
  try {
    // Copy only the JSON data model accepted at the tool boundary. Walking
    // descriptors avoids invoking handler-owned getters/toJSON hooks, while
    // rejecting functions, symbols, custom prototypes, sparse arrays, and
    // other values JSON.stringify would silently erase or coerce.
    const validated = cloneJSONReceiptValue(receipt, new WeakSet());
    const serialized = JSON.stringify(validated);
    if (serialized === undefined) return { ok: false, value: null };
    return { ok: true, value: deepFreeze(JSON.parse(serialized)) };
  } catch {
    return { ok: false, value: null };
  }
}

function cloneJSONReceiptValue(value, ancestors) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TypeError('Idempotency receipt numbers must be finite');
    return value;
  }
  if (!value || typeof value !== 'object') {
    throw new TypeError('Idempotency receipt is outside the JSON data model');
  }
  if (ancestors.has(value)) throw new TypeError('Idempotency receipt must not contain a cycle');

  const descriptors = Object.getOwnPropertyDescriptors(value);
  const ownKeys = Reflect.ownKeys(descriptors);
  const array = Array.isArray(value);
  const prototype = Object.getPrototypeOf(value);
  if ((array && prototype !== Array.prototype)
    || (!array && prototype !== Object.prototype && prototype !== null)) {
    throw new TypeError('Idempotency receipt objects must use JSON-compatible prototypes');
  }

  ancestors.add(value);
  try {
    if (array) {
      const dataKeys = ownKeys.filter(key => key !== 'length');
      if (dataKeys.length !== value.length) {
        throw new TypeError('Idempotency receipt arrays must be dense and contain no extra fields');
      }
      const clone = [];
      for (let index = 0; index < value.length; index += 1) {
        const descriptor = descriptors[String(index)];
        if (!descriptor || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) {
          throw new TypeError('Idempotency receipt arrays must contain enumerable data elements');
        }
        clone.push(cloneJSONReceiptValue(descriptor.value, ancestors));
      }
      return clone;
    }

    const clone = Object.create(null);
    for (const key of ownKeys) {
      if (typeof key !== 'string') {
        throw new TypeError('Idempotency receipt objects must not contain symbol fields');
      }
      const descriptor = descriptors[key];
      if (!descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) {
        throw new TypeError('Idempotency receipt objects must contain enumerable data fields');
      }
      Object.defineProperty(clone, key, {
        value: cloneJSONReceiptValue(descriptor.value, ancestors),
        enumerable: true,
        configurable: true,
        writable: true,
      });
    }
    return clone;
  } finally {
    ancestors.delete(value);
  }
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function boundedInteger(value, label, minimum, maximum) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < minimum || number > maximum) {
    throw new RangeError(`${label} must be an integer from ${minimum} to ${maximum}`);
  }
  return number;
}

function finiteNumber(value, label) {
  const number = Number(value);
  if (!Number.isFinite(number)) throw new TypeError(`${label} must be finite`);
  return number;
}
