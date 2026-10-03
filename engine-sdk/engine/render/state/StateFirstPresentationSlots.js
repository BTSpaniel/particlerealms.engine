// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * Deterministic, renderer-independent allocation of stable object identities
 * onto dense local presentation slots. Slot generations prevent a retained
 * decision from addressing a slot after that slot has been released and reused.
 */

const DEFAULT_MAXIMUM_SLOTS = 65_536;
const MAXIMUM_SLOT_COUNT = 0xffffffff;

function normalizeMaximumSlots(value) {
  const maximumSlots = value == null ? DEFAULT_MAXIMUM_SLOTS : Number(value);
  if (
    !Number.isSafeInteger(maximumSlots) ||
    maximumSlots < 1 ||
    maximumSlots > MAXIMUM_SLOT_COUNT
  ) {
    throw new RangeError(
      `StateFirstPresentationSlots maximumSlots must be a safe integer in [1, ${MAXIMUM_SLOT_COUNT}]`
    );
  }
  return maximumSlots;
}

function normalizeStableId(value) {
  if (typeof value !== "string" || !value || value.trim() !== value) {
    throw new TypeError(
      "StateFirstPresentationSlots stableId must be a nonempty canonical string"
    );
  }
  const normalized = value.normalize("NFC");
  if (normalized !== value) {
    throw new TypeError(
      "StateFirstPresentationSlots stableId must already use Unicode NFC"
    );
  }
  return value;
}

function normalizeSlotId(value, maximumSlots) {
  if (!Number.isSafeInteger(value) || value < 0 || value >= maximumSlots) {
    throw new RangeError(
      `StateFirstPresentationSlots slotId must be a safe integer in [0, ${maximumSlots - 1}]`
    );
  }
  return value;
}

function normalizeGeneration(value) {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new RangeError(
      "StateFirstPresentationSlots generation must be a positive safe integer"
    );
  }
  return value;
}

function insertAscending(values, value) {
  let low = 0;
  let high = values.length;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (values[middle] < value) low = middle + 1;
    else high = middle;
  }
  values.splice(low, 0, value);
}

function frozenBinding(stableId, slotId, generation) {
  return Object.freeze({ stableId, slotId, generation });
}

function frozenRelease(binding, released) {
  return Object.freeze({
    stableId: binding.stableId,
    slotId: binding.slotId,
    generation: binding.generation,
    released,
  });
}

export class StateFirstPresentationSlots {
  constructor(options = {}) {
    if (!options || typeof options !== "object" || Array.isArray(options)) {
      throw new TypeError("StateFirstPresentationSlots options must be an object");
    }
    this.maximumSlots = normalizeMaximumSlots(options.maximumSlots);
    this._entries = [];
    this._freeSlotIds = [];
    this._bindingsByStableId = new Map();
    this._releaseReceipts = new Map();
    this._disposed = false;
    this._disposeReceipt = null;
  }

  get size() {
    return this._bindingsByStableId.size;
  }

  get disposed() {
    return this._disposed;
  }

  allocate(stableId) {
    const id = normalizeStableId(stableId);
    if (this._disposed) {
      throw new Error("StateFirstPresentationSlots has been disposed");
    }
    const current = this._bindingsByStableId.get(id);
    if (current) {
      return current;
    }
    if (this._bindingsByStableId.size >= this.maximumSlots) {
      throw new RangeError(
        `StateFirstPresentationSlots exhausted its ${this.maximumSlots} slots`
      );
    }

    const slotId = this._freeSlotIds.length > 0
      ? this._freeSlotIds.shift()
      : this._entries.length;
    if (slotId >= this.maximumSlots) {
      throw new RangeError(
        `StateFirstPresentationSlots exhausted its ${this.maximumSlots} slots`
      );
    }

    const previous = this._entries[slotId] || null;
    const generation = previous ? previous.generation + 1 : 1;
    if (!Number.isSafeInteger(generation)) {
      if (previous) insertAscending(this._freeSlotIds, slotId);
      throw new RangeError(
        `StateFirstPresentationSlots slot ${slotId} exhausted Number-safe generations`
      );
    }

    const binding = frozenBinding(id, slotId, generation);
    this._entries[slotId] = { stableId: id, generation, binding };
    this._bindingsByStableId.set(id, binding);
    this._releaseReceipts.delete(id);
    return binding;
  }

  release(stableId) {
    const id = normalizeStableId(stableId);
    const current = this._bindingsByStableId.get(id);
    if (!current) {
      const prior = this._releaseReceipts.get(id);
      if (prior) return prior;
      const absent = Object.freeze({
        stableId: id,
        slotId: null,
        generation: null,
        released: false,
      });
      this._releaseReceipts.set(id, absent);
      return absent;
    }

    const entry = this._entries[current.slotId];
    if (
      !entry ||
      entry.stableId !== id ||
      entry.generation !== current.generation
    ) {
      throw new Error(
        `StateFirstPresentationSlots binding for '${id}' is internally inconsistent`
      );
    }

    this._bindingsByStableId.delete(id);
    entry.stableId = null;
    entry.binding = null;
    insertAscending(this._freeSlotIds, current.slotId);
    const receipt = frozenRelease(current, true);
    this._releaseReceipts.set(id, receipt);
    return receipt;
  }

  resolve(stableId) {
    const id = normalizeStableId(stableId);
    return this._bindingsByStableId.get(id) || null;
  }

  assertCurrent(stableId, slotId, generation) {
    const id = normalizeStableId(stableId);
    const admittedSlotId = normalizeSlotId(slotId, this.maximumSlots);
    const admittedGeneration = normalizeGeneration(generation);
    const current = this._bindingsByStableId.get(id);
    if (
      !current ||
      current.slotId !== admittedSlotId ||
      current.generation !== admittedGeneration
    ) {
      throw new RangeError(
        `StateFirstPresentationSlots rejected stale binding for '${id}'`
      );
    }
    return current;
  }

  snapshot() {
    const bindings = Array.from(this._bindingsByStableId.values())
      .sort((left, right) => left.slotId - right.slotId);
    return Object.freeze({
      maximumSlots: this.maximumSlots,
      size: bindings.length,
      highWaterMark: this._entries.length,
      freeSlotCount: this._freeSlotIds.length,
      disposed: this._disposed,
      bindings: Object.freeze(bindings),
    });
  }

  clear() {
    const bindings = Array.from(this._bindingsByStableId.values())
      .sort((left, right) => left.slotId - right.slotId);
    const releases = bindings.map((binding) => this.release(binding.stableId));
    return Object.freeze({
      releasedCount: releases.length,
      releases: Object.freeze(releases),
    });
  }

  dispose() {
    if (this._disposeReceipt) {
      return this._disposeReceipt;
    }
    const cleared = this.clear();
    this._disposed = true;
    this._disposeReceipt = Object.freeze({
      disposed: true,
      releasedCount: cleared.releasedCount,
      releases: cleared.releases,
    });
    return this._disposeReceipt;
  }
}

export function createStateFirstPresentationSlots(options = {}) {
  return new StateFirstPresentationSlots(options);
}
