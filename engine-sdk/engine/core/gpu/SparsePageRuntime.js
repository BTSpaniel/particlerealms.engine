// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

function canonicalKey(value, name = 'page key') {
  const key = String(value ?? '');
  if (!key || key.length > 512) throw new RangeError(`${name} must contain 1 to 512 characters`);
  return key;
}

function uint(value, name) {
  const number = Number(value ?? 0);
  if (!Number.isSafeInteger(number) || number < 0 || number > 0xffffffff) {
    throw new RangeError(`${name} must be a uint32`);
  }
  return number;
}

function pageBytes(value) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number <= 0) throw new RangeError('page bytes must be a positive safe integer');
  return number;
}

function normalizePage(descriptor) {
  if (!descriptor || typeof descriptor !== 'object') throw new TypeError('Sparse page descriptor is required');
  const fallbackKey = descriptor.fallbackKey === null || descriptor.fallbackKey === undefined
    ? null
    : canonicalKey(descriptor.fallbackKey, 'fallbackKey');
  return Object.freeze({
    key: canonicalKey(descriptor.key),
    level: uint(descriptor.level ?? descriptor.mip ?? 0, 'page level'),
    bytes: pageBytes(descriptor.bytes),
    sourceRevision: uint(descriptor.sourceRevision ?? 0, 'sourceRevision'),
    certificateRevision: uint(descriptor.certificateRevision ?? 0, 'certificateRevision'),
    fallbackKey,
    pinned: descriptor.pinned === true,
    payload: descriptor.payload,
    metadata: descriptor.metadata && typeof descriptor.metadata === 'object'
      ? Object.freeze({ ...descriptor.metadata })
      : Object.freeze({}),
  });
}

function cloneEntry(entry) {
  return { ...entry };
}

/**
 * Device-independent, revisioned sparse residency contract shared by field,
 * voxel-derived, and texture pages. A commit is atomic: validation, fallback
 * closure, slot allocation, and eviction all finish before publication.
 */
export class SparsePageRuntime {
  constructor(options = {}) {
    this.capacity = Math.max(1, Math.floor(Number(options.capacity ?? 256)) || 256);
    this.byteBudget = Number(options.byteBudget ?? (64 * 1024 * 1024));
    if (!Number.isSafeInteger(this.byteBudget) || this.byteBudget <= 0) {
      throw new RangeError('Sparse page byteBudget must be a positive safe integer');
    }
    this.requireFallback = options.requireFallback === true;
    this.revision = uint(options.revision ?? 0, 'revision');
    this.generation = 0;
    this._clock = 0;
    this._resident = new Map();
    this._staged = null;
    this._logger = typeof options.logger === 'function' ? options.logger : null;
    this._metrics = {
      commits: 0,
      rollbacks: 0,
      hits: 0,
      misses: 0,
      fallbackHits: 0,
      evictions: 0,
      slotReuses: 0,
      rejectedCommits: 0,
    };
  }

  beginRevision(revision) {
    const next = uint(revision, 'revision');
    if (this._staged) throw new Error('A sparse page revision is already staged');
    if (next !== this.revision + 1) throw new Error(`Sparse page revision ${next} does not follow ${this.revision}`);
    this._staged = { revision: next, add: new Map(), remove: new Set() };
    this._logger?.({ type: 'sparse-pages-stage-begin', revision: next });
    return next;
  }

  stagePage(descriptor) {
    if (!this._staged) throw new Error('beginRevision() must precede stagePage()');
    const page = normalizePage(descriptor);
    this._staged.add.set(page.key, page);
    this._staged.remove.delete(page.key);
    return page;
  }

  stageRemove(key) {
    if (!this._staged) throw new Error('beginRevision() must precede stageRemove()');
    const normalized = canonicalKey(key);
    this._staged.add.delete(normalized);
    this._staged.remove.add(normalized);
  }

  rollbackRevision() {
    if (!this._staged) return false;
    const revision = this._staged.revision;
    this._staged = null;
    this._metrics.rollbacks += 1;
    this._logger?.({ type: 'sparse-pages-stage-rollback', revision });
    return true;
  }

  commitRevision() {
    if (!this._staged) throw new Error('No sparse page revision is staged');
    const staged = this._staged;
    try {
      let nextClock = this._clock;
      let evictionCount = 0;
      let slotReuseCount = 0;
      const next = new Map(Array.from(this._resident, ([key, entry]) => [key, cloneEntry(entry)]));
      const releasedSlots = [];
      for (const key of staged.remove) {
        const previous = next.get(key);
        if (previous) releasedSlots.push(previous.slot);
        next.delete(key);
      }
      for (const [key, page] of staged.add) {
        const previous = next.get(key);
        next.set(key, {
          page,
          slot: previous?.slot ?? -1,
          used: ++nextClock,
        });
      }

      const pinned = Array.from(next.values()).filter(entry => entry.page.pinned);
      if (this.requireFallback && pinned.length === 0) {
        throw new Error('Sparse page publication requires at least one pinned fallback page');
      }
      const pinnedBytes = pinned.reduce((sum, entry) => sum + entry.page.bytes, 0);
      if (pinned.length > this.capacity || pinnedBytes > this.byteBudget) {
        throw new Error('Pinned sparse pages exceed the configured capacity or byte budget');
      }

      const evictionOrder = () => Array.from(next.entries())
        .filter(([, entry]) => !entry.page.pinned)
        .sort((a, b) => a[1].used - b[1].used
          || b[1].page.level - a[1].page.level
          || a[0].localeCompare(b[0]));
      const totalBytes = () => Array.from(next.values()).reduce((sum, entry) => sum + entry.page.bytes, 0);
      let bytes = totalBytes();
      while (next.size > this.capacity || bytes > this.byteBudget) {
        const victim = evictionOrder()[0];
        if (!victim) throw new Error('Sparse page publication cannot satisfy its fixed budget');
        next.delete(victim[0]);
        releasedSlots.push(victim[1].slot);
        bytes -= victim[1].page.bytes;
        evictionCount += 1;
      }

      for (const entry of next.values()) {
        const fallbackKey = entry.page.fallbackKey;
        if (fallbackKey !== null && !next.has(fallbackKey)) {
          throw new Error(`Sparse page ${entry.page.key} has no resident fallback ${fallbackKey}`);
        }
        if (fallbackKey === entry.page.key) throw new Error(`Sparse page ${entry.page.key} cannot fall back to itself`);
        if (!this.requireFallback || entry.page.pinned) continue;
        if (fallbackKey === null) throw new Error(`Sparse page ${entry.page.key} has no fallback chain`);
        const visited = new Set([entry.page.key]);
        let cursor = next.get(fallbackKey);
        while (cursor && !cursor.page.pinned) {
          if (visited.has(cursor.page.key)) {
            throw new Error(`Sparse page ${entry.page.key} contains a cyclic fallback chain`);
          }
          visited.add(cursor.page.key);
          cursor = cursor.page.fallbackKey === null ? null : next.get(cursor.page.fallbackKey);
        }
        if (!cursor?.page.pinned) {
          throw new Error(`Sparse page ${entry.page.key} fallback chain does not terminate at a pinned page`);
        }
      }

      const occupied = new Set(Array.from(next.values()).map(entry => entry.slot).filter(slot => slot >= 0));
      const free = Array.from(new Set(releasedSlots.filter(slot => slot >= 0 && !occupied.has(slot))))
        .sort((a, b) => a - b);
      for (let slot = 0; slot < this.capacity; slot++) if (!occupied.has(slot) && !free.includes(slot)) free.push(slot);
      free.sort((a, b) => a - b);
      for (const entry of next.values()) {
        if (entry.slot >= 0) continue;
        const slot = free.shift();
        if (slot === undefined) throw new Error('Sparse page slot allocation exhausted unexpectedly');
        entry.slot = slot;
        if (releasedSlots.includes(slot)) slotReuseCount += 1;
      }

      const slots = new Set();
      for (const entry of next.values()) {
        if (entry.slot < 0 || entry.slot >= this.capacity || slots.has(entry.slot)) {
          throw new Error('Sparse page publication produced an invalid physical-slot assignment');
        }
        slots.add(entry.slot);
      }

      this._resident = next;
      this._clock = nextClock;
      this.revision = staged.revision;
      this.generation += 1;
      this._staged = null;
      this._metrics.commits += 1;
      this._metrics.evictions += evictionCount;
      this._metrics.slotReuses += slotReuseCount;
      const snapshot = this.snapshot();
      this._logger?.({
        type: 'sparse-pages-published',
        revision: this.revision,
        generation: this.generation,
        pages: snapshot.pages.length,
        bytes: snapshot.bytes,
      });
      return snapshot;
    } catch (error) {
      this._metrics.rejectedCommits += 1;
      this._logger?.({ type: 'sparse-pages-publication-rejected', revision: staged.revision, error: String(error) });
      throw error;
    }
  }

  has(key) {
    return this._resident.has(canonicalKey(key));
  }

  setBudget({ capacity = this.capacity, byteBudget = this.byteBudget } = {}) {
    if (this._staged) throw new Error('Cannot change sparse page budgets during a staged revision');
    const nextCapacity = Math.max(1, Math.floor(Number(capacity)) || 0);
    const nextBytes = Number(byteBudget);
    if (!Number.isSafeInteger(nextBytes) || nextBytes <= 0) {
      throw new RangeError('Sparse page byteBudget must be a positive safe integer');
    }
    this.capacity = nextCapacity;
    this.byteBudget = nextBytes;
    return Object.freeze({ capacity: this.capacity, byteBudget: this.byteBudget });
  }

  resolve(key, fallbackKeys = []) {
    const requested = canonicalKey(key);
    const candidates = [requested, ...Array.from(fallbackKeys, value => canonicalKey(value, 'fallback key'))];
    for (let index = 0; index < candidates.length; index++) {
      const entry = this._resident.get(candidates[index]);
      if (!entry) continue;
      entry.used = ++this._clock;
      this._metrics.hits += 1;
      if (index > 0) this._metrics.fallbackHits += 1;
      return Object.freeze({ ...entry.page, slot: entry.slot, fallback: index > 0, requestedKey: requested });
    }
    this._metrics.misses += 1;
    return null;
  }

  snapshot() {
    const pages = Array.from(this._resident.values())
      .sort((a, b) => a.slot - b.slot)
      .map(entry => Object.freeze({
        key: entry.page.key,
        level: entry.page.level,
        bytes: entry.page.bytes,
        sourceRevision: entry.page.sourceRevision,
        certificateRevision: entry.page.certificateRevision,
        fallbackKey: entry.page.fallbackKey,
        pinned: entry.page.pinned,
        slot: entry.slot,
        metadata: entry.page.metadata,
      }));
    return Object.freeze({
      revision: this.revision,
      generation: this.generation,
      capacity: this.capacity,
      byteBudget: this.byteBudget,
      bytes: pages.reduce((sum, page) => sum + page.bytes, 0),
      pages: Object.freeze(pages),
    });
  }

  getStats() {
    const snapshot = this.snapshot();
    return Object.freeze({
      ...this._metrics,
      revision: snapshot.revision,
      generation: snapshot.generation,
      pages: snapshot.pages.length,
      bytes: snapshot.bytes,
      capacity: snapshot.capacity,
      byteBudget: snapshot.byteBudget,
    });
  }
}

export function createSparsePageRuntime(options) {
  return new SparsePageRuntime(options);
}
