// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * Retained state backing for state-first renderers.
 *
 * Entity state lives at a stable entity-id-derived offset while each visual
 * representation owns a dense u32 indirection bucket.  Representation changes
 * therefore never move authoritative state, and an entity may participate in
 * two buckets while an LOD cross-fade is in progress.
 */

export const STATE_FIRST_RETAINED_RECORD_FLOATS = 12;
export const STATE_FIRST_RETAINED_RECORD_BYTES = STATE_FIRST_RETAINED_RECORD_FLOATS * Float32Array.BYTES_PER_ELEMENT;
export const STATE_FIRST_RETAINED_INDEX_BYTES = Uint32Array.BYTES_PER_ELEMENT;

const DEFAULT_STORAGE_LIMIT = 128 * 1024 * 1024;
const DEFAULT_BUFFER_LIMIT = 256 * 1024 * 1024;
const DEFAULT_INITIAL_CAPACITY = 1024;
const MIN_GROWTH_QUANTUM = 256;

const BUFFER_USAGE = globalThis.GPUBufferUsage || Object.freeze({
  COPY_SRC: 0x0004,
  COPY_DST: 0x0008,
  STORAGE: 0x0080,
});

const COUNTER_KEYS = Object.freeze([
  'stateRecordsChanged',
  'entitiesActivated',
  'entitiesReleased',
  'presentationAdds',
  'presentationRemoves',
  'swapMoves',
  'stateUploadBytes',
  'stateUploadRanges',
  'indexUploadBytes',
  'indexUploadRanges',
  'growthEvents',
]);

function makeCounters() {
  return Object.fromEntries(COUNTER_KEYS.map((key) => [key, 0]));
}

function finitePositiveLimit(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Math.floor(number) : fallback;
}

function alignUp(value, alignment) {
  return Math.ceil(value / alignment) * alignment;
}

function normalizeEntityId(entityId) {
  const id = Number(entityId);
  if (!Number.isSafeInteger(id) || id < 0 || id > 0xfffffffe) {
    throw new RangeError(`StateFirstRetainedStorage entity id must be an integer in [0, 2^32-2]; received ${entityId}`);
  }
  return id;
}

function normalizeRepresentation(representation) {
  const value = Number(representation);
  if (!Number.isInteger(value) || value < 1 || value > 0xffffffff) {
    throw new RangeError(`StateFirstRetainedStorage representation must be a positive u32; received ${representation}`);
  }
  return value;
}

function normalizePresentations(representations, unique = []) {
  unique.length = 0;
  if (representations == null || representations === 0) return unique;
  if (typeof representations === 'number') {
    unique.push(normalizeRepresentation(representations));
    return unique;
  }
  const source = representations;
  if (typeof source === 'string' || typeof source?.[Symbol.iterator] !== 'function') {
    throw new TypeError('StateFirstRetainedStorage presentations must be a representation or an iterable of representations');
  }
  for (const representation of source) {
    if (representation === 0 || representation == null) continue;
    const normalized = normalizeRepresentation(representation);
    if (!unique.includes(normalized)) unique.push(normalized);
  }
  return unique;
}

function vector4Into(target, offset, vector, defaultW) {
  if (vector == null) {
    target[offset + 3] = defaultW;
    return;
  }
  const x = vector[0] ?? vector.x ?? 0;
  const y = vector[1] ?? vector.y ?? 0;
  const z = vector[2] ?? vector.z ?? 0;
  const w = vector[3] ?? vector.w ?? defaultW;
  target[offset] = Number(x);
  target[offset + 1] = Number(y);
  target[offset + 2] = Number(z);
  target[offset + 3] = Number(w);
}

function packRecordInto(target, record) {
  if (record instanceof ArrayBuffer) {
    if (record.byteLength < STATE_FIRST_RETAINED_RECORD_BYTES) {
      throw new RangeError(`StateFirstRetainedStorage record needs ${STATE_FIRST_RETAINED_RECORD_BYTES} bytes`);
    }
    target.set(new Float32Array(record, 0, STATE_FIRST_RETAINED_RECORD_FLOATS));
    return;
  }
  if (ArrayBuffer.isView(record) || Array.isArray(record)) {
    if (record.length < STATE_FIRST_RETAINED_RECORD_FLOATS) {
      throw new RangeError(`StateFirstRetainedStorage record needs ${STATE_FIRST_RETAINED_RECORD_FLOATS} floats`);
    }
    for (let index = 0; index < STATE_FIRST_RETAINED_RECORD_FLOATS; index += 1) target[index] = Number(record[index]);
    return;
  }
  if (record && typeof record === 'object') {
    const flat = record.record || record.data || record.values;
    if (flat != null) {
      packRecordInto(target, flat);
      return;
    }
    target.fill(0);
    vector4Into(target, 0, record.current || record.position || record.state0, 1);
    vector4Into(target, 4, record.previous || record.velocity || record.state1, 0);
    vector4Into(target, 8, record.metadata || record.presentation || record.state2, 0);
    return;
  }
  throw new TypeError('StateFirstRetainedStorage record must be 12 floats, three vector-like fields, or a packer function');
}

class DirtyRanges {
  constructor() {
    this.ranges = [];
  }

  mark(start, end = start + 1) {
    if (end <= start) return;
    const last = this.ranges[this.ranges.length - 1];
    if (last && start >= last[0] && start <= last[1]) {
      last[1] = Math.max(last[1], end);
      return;
    }
    this.ranges.push([start, end]);
  }

  coalesced() {
    if (this.ranges.length <= 1) return this.ranges.map((range) => range.slice());
    const ordered = this.ranges.map((range) => range.slice()).sort((left, right) => left[0] - right[0]);
    const result = [ordered[0]];
    for (let index = 1; index < ordered.length; index += 1) {
      const range = ordered[index];
      const last = result[result.length - 1];
      if (range[0] <= last[1]) last[1] = Math.max(last[1], range[1]);
      else result.push(range);
    }
    return result;
  }

  entryCount() {
    return this.coalesced().reduce((sum, range) => sum + range[1] - range[0], 0);
  }

  clear() {
    this.ranges.length = 0;
  }
}

function makeBucketPublicView(bucket) {
  const view = { representation: bucket.representation };
  Object.defineProperties(view, {
    indexBuffer: { enumerable: true, get: () => bucket.indexBuffer },
    count: { enumerable: true, get: () => bucket.count },
    capacity: { enumerable: true, get: () => bucket.ids.length },
    generation: { enumerable: true, get: () => bucket.generation },
  });
  return Object.freeze(view);
}

export class StateFirstRetainedStorage {
  constructor(device, options = {}) {
    if (!device?.createBuffer || !device?.queue?.writeBuffer) {
      throw new TypeError('StateFirstRetainedStorage requires a GPUDevice with createBuffer() and queue.writeBuffer()');
    }
    this.device = device;
    this.label = options.label || 'StateFirstRetainedStorage';
    // Large retained pools must not double their aggregate CPU/GPU residency
    // at a power-of-two boundary. Callers may provide a tighter slab plan;
    // this bounded default keeps generic users below a 25% geometric jump.
    this.growthFactor = Math.max(1.1, Number(options.growthFactor) || 1.25);
    this.destroyed = false;
    this.frameIndex = 0;
    this.generation = 0;
    this.capacity = 0;
    this.stateHighWater = 0;
    this.retainedEntityCount = 0;
    this.presentationCount = 0;
    this.stateBuffer = null;
    this.stateData = new Float32Array(0);
    this.entityActive = new Uint8Array(0);
    this.buckets = new Map();
    this.stateDirty = new DirtyRanges();
    this.frameCounters = makeCounters();
    this.lifetimeCounters = makeCounters();
    this.lastFlush = Object.freeze({ stateBytes: 0, stateRanges: 0, indexBytes: 0, indexRanges: 0 });
    this._recordScratch = new Float32Array(STATE_FIRST_RETAINED_RECORD_FLOATS);
    this._presentationScratch = [];

    if (options.recordFloats != null && Number(options.recordFloats) !== STATE_FIRST_RETAINED_RECORD_FLOATS) {
      throw new RangeError(`StateFirstRetainedStorage uses a fixed ${STATE_FIRST_RETAINED_RECORD_FLOATS}-float record ABI`);
    }

    const storageLimit = finitePositiveLimit(device.limits?.maxStorageBufferBindingSize, DEFAULT_STORAGE_LIMIT);
    const bufferLimit = finitePositiveLimit(device.limits?.maxBufferSize, DEFAULT_BUFFER_LIMIT);
    this.maxStateBufferBytes = Math.min(storageLimit, bufferLimit);
    this.maxIndexBufferBytes = Math.min(storageLimit, bufferLimit);
    const adapterCapacity = Math.min(
      Math.floor(this.maxStateBufferBytes / STATE_FIRST_RETAINED_RECORD_BYTES),
      Math.floor(this.maxIndexBufferBytes / STATE_FIRST_RETAINED_INDEX_BYTES),
      0xfffffffe,
    );
    const requestedMaximum = options.maxCapacity == null
      ? adapterCapacity
      : Math.max(1, Math.floor(Number(options.maxCapacity) || 1));
    this.maxCapacity = Math.min(adapterCapacity, requestedMaximum);
    if (this.maxCapacity < 1) throw new RangeError('StateFirstRetainedStorage adapter limits cannot hold one 48-byte state record');

    const initialCapacity = Math.min(
      this.maxCapacity,
      Math.max(1, Math.floor(Number(options.initialCapacity ?? options.capacity) || DEFAULT_INITIAL_CAPACITY)),
    );
    this.ensureCapacity(initialCapacity);
    for (const representation of normalizePresentations(options.representations)) this._ensureBucket(representation);
    this.frameCounters = makeCounters();
    this.lifetimeCounters = makeCounters();
  }

  _assertLive() {
    if (this.destroyed) throw new Error('StateFirstRetainedStorage has been destroyed');
  }

  _increment(key, amount = 1) {
    this.frameCounters[key] += amount;
    this.lifetimeCounters[key] += amount;
  }

  _activate(id) {
    if (this.entityActive[id]) return false;
    this.entityActive[id] = 1;
    this.retainedEntityCount += 1;
    this.stateHighWater = Math.max(this.stateHighWater, id + 1);
    this._increment('entitiesActivated');
    return true;
  }

  _createGpuBuffer(label, byteSize) {
    return this.device.createBuffer({
      label,
      size: Math.max(4, alignUp(byteSize, 4)),
      usage: BUFFER_USAGE.STORAGE | BUFFER_USAGE.COPY_DST | BUFFER_USAGE.COPY_SRC,
    });
  }

  _ensureBucket(representation) {
    let bucket = this.buckets.get(representation);
    if (bucket) return bucket;
    const memberships = new Int32Array(this.capacity);
    memberships.fill(-1);
    bucket = {
      representation,
      ids: new Uint32Array(this.capacity),
      memberships,
      count: 0,
      indexBuffer: this._createGpuBuffer(`${this.label}.representation.${representation}`, this.capacity * STATE_FIRST_RETAINED_INDEX_BYTES),
      dirty: new DirtyRanges(),
      generation: this.generation,
      publicView: null,
    };
    bucket.publicView = makeBucketPublicView(bucket);
    this.buckets.set(representation, bucket);
    return bucket;
  }

  beginFrame(frameIndex = null) {
    this._assertLive();
    this.frameIndex = frameIndex == null ? this.frameIndex + 1 : Math.max(0, Math.floor(Number(frameIndex) || 0));
    this.frameCounters = makeCounters();
    this.lastFlush = Object.freeze({ stateBytes: 0, stateRanges: 0, indexBytes: 0, indexRanges: 0 });
    return this.frameIndex;
  }

  ensureCapacity(requiredCapacity) {
    this._assertLive();
    const required = Math.max(1, Math.floor(Number(requiredCapacity) || 1));
    if (required <= this.capacity) return false;
    if (required > this.maxCapacity) {
      const error = new RangeError(`StateFirstRetainedStorage needs ${required} records, exceeding the adapter-aware maximum ${this.maxCapacity}`);
      error.code = 'STATE_FIRST_RETAINED_CAPACITY_EXCEEDED';
      throw error;
    }

    const geometric = Math.ceil(Math.max(required, this.capacity * this.growthFactor));
    const nextCapacity = Math.min(this.maxCapacity, Math.max(required, alignUp(geometric, MIN_GROWTH_QUANTUM)));
    const nextStateData = new Float32Array(nextCapacity * STATE_FIRST_RETAINED_RECORD_FLOATS);
    nextStateData.set(this.stateData.subarray(0, this.stateHighWater * STATE_FIRST_RETAINED_RECORD_FLOATS));
    const nextEntityActive = new Uint8Array(nextCapacity);
    nextEntityActive.set(this.entityActive.subarray(0, this.stateHighWater));
    const nextBuckets = new Map();
    const newlyCreatedBuffers = [];

    try {
      const nextStateBuffer = this._createGpuBuffer(`${this.label}.state.${this.generation + 1}`, nextCapacity * STATE_FIRST_RETAINED_RECORD_BYTES);
      newlyCreatedBuffers.push(nextStateBuffer);
      for (const [representation, bucket] of this.buckets) {
        const memberships = new Int32Array(nextCapacity);
        memberships.fill(-1);
        memberships.set(bucket.memberships.subarray(0, this.stateHighWater));
        const ids = new Uint32Array(nextCapacity);
        ids.set(bucket.ids.subarray(0, bucket.count));
        const indexBuffer = this._createGpuBuffer(`${this.label}.representation.${representation}.${this.generation + 1}`, nextCapacity * STATE_FIRST_RETAINED_INDEX_BYTES);
        newlyCreatedBuffers.push(indexBuffer);
        nextBuckets.set(representation, { bucket, memberships, ids, indexBuffer });
      }

      let stateBytes = 0;
      let stateRanges = 0;
      let indexBytes = 0;
      let indexRanges = 0;
      if (this.stateHighWater > 0) {
        stateBytes = this.stateHighWater * STATE_FIRST_RETAINED_RECORD_BYTES;
        this.device.queue.writeBuffer(nextStateBuffer, 0, nextStateData.buffer, 0, stateBytes);
        stateRanges = 1;
      }
      for (const { bucket, ids, indexBuffer } of nextBuckets.values()) {
        if (bucket.count < 1) continue;
        const bytes = bucket.count * STATE_FIRST_RETAINED_INDEX_BYTES;
        this.device.queue.writeBuffer(indexBuffer, 0, ids.buffer, 0, bytes);
        indexBytes += bytes;
        indexRanges += 1;
      }

      const oldStateBuffer = this.stateBuffer;
      const oldBucketBuffers = [...this.buckets.values()].map((bucket) => bucket.indexBuffer);
      this.stateBuffer = nextStateBuffer;
      this.stateData = nextStateData;
      this.entityActive = nextEntityActive;
      this.capacity = nextCapacity;
      this.generation += 1;
      for (const { bucket, memberships, ids, indexBuffer } of nextBuckets.values()) {
        bucket.memberships = memberships;
        bucket.ids = ids;
        bucket.indexBuffer = indexBuffer;
        bucket.generation = this.generation;
        bucket.dirty.clear();
      }
      this.stateDirty.clear();
      this._increment('growthEvents');
      if (stateBytes) {
        this._increment('stateUploadBytes', stateBytes);
        this._increment('stateUploadRanges', stateRanges);
      }
      if (indexBytes) {
        this._increment('indexUploadBytes', indexBytes);
        this._increment('indexUploadRanges', indexRanges);
      }
      oldStateBuffer?.destroy?.();
      for (const buffer of oldBucketBuffers) buffer?.destroy?.();
      return true;
    } catch (error) {
      for (const buffer of newlyCreatedBuffers) {
        try { buffer?.destroy?.(); } catch { /* retain the original allocation after cleanup uncertainty */ }
      }
      throw error;
    }
  }

  getStateBuffer() {
    this._assertLive();
    return this.stateBuffer;
  }

  getBucket(representation) {
    this._assertLive();
    return this._ensureBucket(normalizeRepresentation(representation)).publicView;
  }

  writeState(entityId, recordOrPacker) {
    this._assertLive();
    const id = normalizeEntityId(entityId);
    this.ensureCapacity(id + 1);
    let record = recordOrPacker;
    if (!(recordOrPacker instanceof Float32Array) || recordOrPacker.length < STATE_FIRST_RETAINED_RECORD_FLOATS) {
      this._recordScratch.fill(0);
      if (typeof recordOrPacker === 'function') {
        const packed = recordOrPacker(this._recordScratch, id, this);
        if (packed != null && packed !== this._recordScratch) packRecordInto(this._recordScratch, packed);
      } else {
        packRecordInto(this._recordScratch, recordOrPacker);
      }
      record = this._recordScratch;
    }
    for (let index = 0; index < STATE_FIRST_RETAINED_RECORD_FLOATS; index += 1) {
      if (!Number.isFinite(record[index])) {
        throw new TypeError(`StateFirstRetainedStorage record ${id} contains a non-finite value at float ${index}`);
      }
    }

    this._activate(id);
    const offset = id * STATE_FIRST_RETAINED_RECORD_FLOATS;
    let changed = false;
    for (let index = 0; index < STATE_FIRST_RETAINED_RECORD_FLOATS; index += 1) {
      if (!Object.is(this.stateData[offset + index], record[index])) {
        changed = true;
        break;
      }
    }
    if (!changed) return false;
    this.stateData.set(record.subarray ? record.subarray(0, STATE_FIRST_RETAINED_RECORD_FLOATS) : record, offset);
    this.stateDirty.mark(id);
    this._increment('stateRecordsChanged');
    return true;
  }

  _addPresentation(bucket, id) {
    if (bucket.memberships[id] >= 0) return false;
    const slot = bucket.count;
    bucket.ids[slot] = id;
    bucket.memberships[id] = slot;
    bucket.count += 1;
    bucket.dirty.mark(slot);
    this.presentationCount += 1;
    this._increment('presentationAdds');
    return true;
  }

  _removePresentation(bucket, id) {
    const slot = bucket.memberships[id];
    if (slot < 0) return false;
    const lastSlot = bucket.count - 1;
    if (slot !== lastSlot) {
      const movedId = bucket.ids[lastSlot];
      bucket.ids[slot] = movedId;
      bucket.memberships[movedId] = slot;
      bucket.dirty.mark(slot);
      this._increment('swapMoves');
    }
    bucket.memberships[id] = -1;
    bucket.count = lastSlot;
    this.presentationCount -= 1;
    this._increment('presentationRemoves');
    return true;
  }

  setPresentations(entityId, representations) {
    this._assertLive();
    const id = normalizeEntityId(entityId);
    this.ensureCapacity(id + 1);
    this._activate(id);
    const desiredList = normalizePresentations(representations, this._presentationScratch);
    let added = 0;
    let removed = 0;

    for (const [representation, bucket] of this.buckets) {
      if (bucket.memberships[id] >= 0 && !desiredList.includes(representation)) {
        if (this._removePresentation(bucket, id)) removed += 1;
      }
    }
    for (const representation of desiredList) {
      if (this._addPresentation(this._ensureBucket(representation), id)) added += 1;
    }
    return added + removed > 0;
  }

  releaseEntity(entityId) {
    this._assertLive();
    const id = normalizeEntityId(entityId);
    if (id >= this.capacity || !this.entityActive[id]) return false;
    for (const bucket of this.buckets.values()) this._removePresentation(bucket, id);
    this.entityActive[id] = 0;
    this.retainedEntityCount -= 1;
    this.stateData.fill(0, id * STATE_FIRST_RETAINED_RECORD_FLOATS, (id + 1) * STATE_FIRST_RETAINED_RECORD_FLOATS);
    this.stateDirty.mark(id);
    this._increment('stateRecordsChanged');
    this._increment('entitiesReleased');
    return true;
  }

  flush() {
    this._assertLive();
    const stateRanges = this.stateDirty.coalesced();
    const bucketRanges = [];
    for (const bucket of this.buckets.values()) {
      const ranges = bucket.dirty.coalesced();
      if (ranges.length) bucketRanges.push({ bucket, ranges });
    }
    let stateBytes = 0;
    let indexBytes = 0;
    let indexRangeCount = 0;

    try {
      for (const [start, end] of stateRanges) {
        const byteOffset = start * STATE_FIRST_RETAINED_RECORD_BYTES;
        const byteLength = (end - start) * STATE_FIRST_RETAINED_RECORD_BYTES;
        this.device.queue.writeBuffer(this.stateBuffer, byteOffset, this.stateData.buffer, byteOffset, byteLength);
        stateBytes += byteLength;
      }
      for (const { bucket, ranges } of bucketRanges) {
        for (const [start, end] of ranges) {
          const byteOffset = start * STATE_FIRST_RETAINED_INDEX_BYTES;
          const byteLength = (end - start) * STATE_FIRST_RETAINED_INDEX_BYTES;
          this.device.queue.writeBuffer(bucket.indexBuffer, byteOffset, bucket.ids.buffer, byteOffset, byteLength);
          indexBytes += byteLength;
          indexRangeCount += 1;
        }
      }
    } catch (error) {
      throw error;
    }

    this.stateDirty.clear();
    for (const { bucket } of bucketRanges) bucket.dirty.clear();
    if (stateBytes) {
      this._increment('stateUploadBytes', stateBytes);
      this._increment('stateUploadRanges', stateRanges.length);
    }
    if (indexBytes) {
      this._increment('indexUploadBytes', indexBytes);
      this._increment('indexUploadRanges', indexRangeCount);
    }
    this.lastFlush = Object.freeze({
      stateBytes,
      stateRanges: stateRanges.length,
      indexBytes,
      indexRanges: indexRangeCount,
    });
    return this.lastFlush;
  }

  getStats() {
    this._assertLive();
    const buckets = {};
    let dirtyIndexEntries = 0;
    for (const [representation, bucket] of this.buckets) {
      const dirtyEntries = bucket.dirty.entryCount();
      dirtyIndexEntries += dirtyEntries;
      buckets[representation] = Object.freeze({
        count: bucket.count,
        dirtyEntries,
        capacity: bucket.ids.length,
        generation: bucket.generation,
      });
    }
    return Object.freeze({
      frameIndex: this.frameIndex,
      generation: this.generation,
      capacity: this.capacity,
      maxCapacity: this.maxCapacity,
      retainedEntityCount: this.retainedEntityCount,
      stateHighWater: this.stateHighWater,
      presentationCount: this.presentationCount,
      bucketCount: this.buckets.size,
      dirtyStateRecords: this.stateDirty.entryCount(),
      dirtyIndexEntries,
      gpuAllocatedBytes: this.capacity * (
        STATE_FIRST_RETAINED_RECORD_BYTES
        + this.buckets.size * STATE_FIRST_RETAINED_INDEX_BYTES
      ),
      frame: Object.freeze({ ...this.frameCounters }),
      lifetime: Object.freeze({ ...this.lifetimeCounters }),
      lastFlush: this.lastFlush,
      buckets: Object.freeze(buckets),
    });
  }

  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    this.stateBuffer?.destroy?.();
    this.stateBuffer = null;
    for (const bucket of this.buckets.values()) bucket.indexBuffer?.destroy?.();
    this.buckets.clear();
    this.stateDirty.clear();
    this.stateData = new Float32Array(0);
    this.entityActive = new Uint8Array(0);
    this.capacity = 0;
    this.retainedEntityCount = 0;
    this.presentationCount = 0;
  }
}

export function createStateFirstRetainedStorage(device, options) {
  return new StateFirstRetainedStorage(device, options);
}
