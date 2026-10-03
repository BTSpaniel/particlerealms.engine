// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/** Explicit semantic and confluence-proven CRDT adapters for three-way merge. */

import { GSet } from '../../../state/consistency/CRDT.js';
import { link, toposort } from '../../../state/facts/Causality.js';
import { canonicalize, hashIdSecure } from '../../../state/util/canonical.js';
import { deepFreeze } from '../capsule/RealmCapsuleSchema.js';

export const SEMANTIC_COMPARISON_FORMAT = 'realm-semantic-comparison-v1';
export const REALM_MAP_RECORD_TYPE = 'realm.map-v1';
export const REALM_GSET_RECORD_TYPE = 'realm.gset-v1';

const TOKEN = /^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,255}$/;
const MAX_RECORDS = 10000;
const MAX_DEPENDENCIES = 256;
const MAX_RECORD_BYTES = 1024 * 1024;
const encoder = new TextEncoder();

function token(value, name) {
  const text = String(value ?? '').trim();
  if (!TOKEN.test(text)) throw new TypeError(`${name} is invalid`);
  return text;
}

function plainObject(value, name) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.getPrototypeOf(value) !== Object.prototype) {
    throw new TypeError(`${name} must be a plain object`);
  }
  return value;
}

function jsonClone(value) {
  const text = canonicalize(value);
  if (encoder.encode(text).byteLength > MAX_RECORD_BYTES) throw new Error('semantic record exceeds the size limit');
  return JSON.parse(text);
}

function equal(left, right) { return canonicalize(left) === canonicalize(right); }

function uniqueTokens(values, name) {
  if (!Array.isArray(values) || values.length > MAX_DEPENDENCIES) throw new TypeError(`${name} must be a bounded array`);
  const normalized = [...new Set(values.map((value) => token(value, name)))].sort();
  if (normalized.length !== values.length) throw new TypeError(`${name} contains duplicate values`);
  return Object.freeze(normalized);
}

function normalizeRecord(recordId, value) {
  plainObject(value, `record ${recordId}`);
  const normalized = {
    type: token(value.type, `record ${recordId} type`),
    value: jsonClone(value.value),
    dependsOn: uniqueTokens(value.dependsOn ?? [], `record ${recordId} dependencies`),
  };
  return deepFreeze(normalized);
}

export function normalizeSemanticSnapshot(value) {
  const entries = value instanceof Map ? [...value.entries()] : Object.entries(plainObject(value ?? {}, 'semantic snapshot'));
  if (entries.length > MAX_RECORDS) throw new Error('semantic snapshot record limit reached');
  const normalized = {};
  for (const [rawId, record] of entries.sort(([left], [right]) => String(left).localeCompare(String(right)))) {
    const recordId = token(rawId, 'semantic record ID');
    if (Object.hasOwn(normalized, recordId)) throw new Error(`duplicate semantic record ${recordId}`);
    normalized[recordId] = normalizeRecord(recordId, record);
  }
  return deepFreeze(normalized);
}

export async function hashSemanticChange(change) {
  const core = {
    recordId: change.recordId,
    recordType: change.recordType,
    operation: change.operation,
    path: change.path,
    base: change.base,
    mine: change.mine,
    theirs: change.theirs,
    proposed: change.proposed,
    conflict: !!change.conflict,
    recordDependencyIds: change.recordDependencyIds,
  };
  return hashIdSecure(core, {
    domain: 'realm-network.semantic-change',
    schemaVersion: 'v1',
  });
}

function presentSlot(value) { return deepFreeze({ present: true, value: jsonClone(value) }); }
function absentSlot() { return Object.freeze({ present: false, value: null }); }
function fieldSlot(object, key) {
  return Object.hasOwn(object, key) ? presentSlot(object[key]) : absentSlot();
}

function chooseThreeWay(base, mine, theirs) {
  if (equal(mine, theirs)) return { conflict: false, proposed: mine };
  if (equal(mine, base)) return { conflict: false, proposed: theirs };
  if (equal(theirs, base)) return { conflict: false, proposed: mine };
  return { conflict: true, proposed: null };
}

function assertSlot(value, name) {
  if (!value || typeof value !== 'object' || typeof value.present !== 'boolean') {
    throw new TypeError(`${name} slot is invalid`);
  }
  return value.present ? presentSlot(value.value) : absentSlot();
}

export class SemanticAdapterRegistry {
  constructor() { this._adapters = new Map(); }

  register(recordType, adapter, options = {}) {
    const type = token(recordType, 'semantic adapter record type');
    if (this._adapters.has(type)) throw new Error(`semantic adapter already registered for ${type}`);
    if (!adapter || typeof adapter.validate !== 'function'
      || typeof adapter.compare !== 'function' || typeof adapter.apply !== 'function') {
      throw new TypeError('semantic adapter requires validate, compare, and apply functions');
    }
    const mode = options.mode ?? 'semantic';
    if (mode !== 'semantic' && mode !== 'crdt') throw new TypeError('semantic adapter mode is invalid');
    let confluence = null;
    if (mode === 'crdt') {
      const assertion = options.confluence;
      if (!assertion || assertion.asserted !== true || typeof assertion.proof !== 'string'
        || assertion.proof.trim().length < 16 || typeof adapter.merge !== 'function') {
        throw new Error('CRDT adapter registration requires an explicit confluence assertion and merge function');
      }
      confluence = Object.freeze({ asserted: true, proof: assertion.proof.trim() });
    }
    this._adapters.set(type, Object.freeze({ type, mode, confluence, adapter }));
    return this;
  }

  has(recordType) { return this._adapters.has(String(recordType)); }
  get(recordType) {
    const registered = this._adapters.get(String(recordType));
    if (!registered) throw new Error(`no semantic adapter registered for ${recordType}`);
    return registered;
  }
  types() { return Object.freeze([...this._adapters.keys()].sort()); }
}

const mapAdapter = Object.freeze({
  validate(value) { plainObject(value, 'realm map record'); jsonClone(value); },
  compare(base, mine, theirs) {
    this.validate(base); this.validate(mine); this.validate(theirs);
    const changes = [];
    const keys = [...new Set([...Object.keys(base), ...Object.keys(mine), ...Object.keys(theirs)])].sort();
    for (const key of keys) {
      const baseSlot = fieldSlot(base, key);
      const mineSlot = fieldSlot(mine, key);
      const theirsSlot = fieldSlot(theirs, key);
      const selection = chooseThreeWay(baseSlot, mineSlot, theirsSlot);
      if (!selection.conflict && equal(selection.proposed, baseSlot)) continue;
      changes.push({
        operation: 'field',
        path: [key],
        base: baseSlot,
        mine: mineSlot,
        theirs: theirsSlot,
        proposed: selection.proposed,
        conflict: selection.conflict,
      });
    }
    return changes;
  },
  apply(record, change, selected) {
    this.validate(record.value);
    const key = change.path[0];
    const value = jsonClone(record.value);
    const slot = assertSlot(selected, 'selected map field');
    if (slot.present) value[key] = slot.value;
    else delete value[key];
    return { ...record, value };
  },
});

const gsetAdapter = Object.freeze({
  validate(value) {
    if (!Array.isArray(value)) throw new TypeError('realm GSet record must be an array');
    const canonical = value.map(canonicalize);
    if (new Set(canonical).size !== canonical.length) throw new TypeError('realm GSet contains duplicate values');
    jsonClone(value);
  },
  merge(mine, theirs) {
    this.validate(mine); this.validate(theirs);
    return new GSet(mine.map(canonicalize).concat(theirs.map(canonicalize)))
      .value().map((encoded) => JSON.parse(encoded));
  },
  compare(base, mine, theirs) {
    this.validate(base); this.validate(mine); this.validate(theirs);
    const baseValues = new Set(base.map(canonicalize));
    const mineValues = new Set(mine.map(canonicalize));
    const theirsValues = new Set(theirs.map(canonicalize));
    const removed = [...baseValues].some((value) => !mineValues.has(value) || !theirsValues.has(value));
    const baseSlot = presentSlot(base);
    const mineSlot = presentSlot(mine);
    const theirsSlot = presentSlot(theirs);
    if (removed) {
      return [{ operation: 'value', path: [], base: baseSlot, mine: mineSlot, theirs: theirsSlot, proposed: null, conflict: true }];
    }
    const merged = presentSlot(this.merge(mine, theirs));
    if (equal(merged, baseSlot)) return [];
    return [{ operation: 'value', path: [], base: baseSlot, mine: mineSlot, theirs: theirsSlot, proposed: merged, conflict: false }];
  },
  apply(record, _change, selected) {
    const slot = assertSlot(selected, 'selected GSet value');
    if (!slot.present) throw new Error('GSet values cannot be deleted through a value merge');
    this.validate(slot.value);
    return { ...record, value: slot.value };
  },
});

export function createDefaultSemanticAdapterRegistry() {
  return new SemanticAdapterRegistry()
    .register(REALM_MAP_RECORD_TYPE, mapAdapter, { mode: 'semantic' })
    .register(REALM_GSET_RECORD_TYPE, gsetAdapter, {
      mode: 'crdt',
      confluence: {
        asserted: true,
        proof: 'CSE GSet merge is the associative, commutative, idempotent set-union join.',
      },
    });
}

function wholeRecordCandidate(recordId, base, mine, theirs) {
  const baseSlot = base ? presentSlot(base) : absentSlot();
  const mineSlot = mine ? presentSlot(mine) : absentSlot();
  const theirsSlot = theirs ? presentSlot(theirs) : absentSlot();
  const selection = chooseThreeWay(baseSlot, mineSlot, theirsSlot);
  if (!selection.conflict && equal(selection.proposed, baseSlot)) return [];
  return [{
    recordId,
    recordType: mine?.type ?? theirs?.type ?? base?.type,
    operation: 'record',
    path: [],
    base: baseSlot,
    mine: mineSlot,
    theirs: theirsSlot,
    proposed: selection.proposed,
    conflict: selection.conflict,
  }];
}

function metadataCandidate(recordId, type, base, mine, theirs) {
  const baseSlot = presentSlot(base.dependsOn);
  const mineSlot = presentSlot(mine.dependsOn);
  const theirsSlot = presentSlot(theirs.dependsOn);
  const selection = chooseThreeWay(baseSlot, mineSlot, theirsSlot);
  if (!selection.conflict && equal(selection.proposed, baseSlot)) return [];
  return [{
    recordId,
    recordType: type,
    operation: 'dependencies',
    path: ['$dependencies'],
    base: baseSlot,
    mine: mineSlot,
    theirs: theirsSlot,
    proposed: selection.proposed,
    conflict: selection.conflict,
  }];
}

function candidatesForRecord(recordId, base, mine, theirs, registry) {
  if (!base || !mine || !theirs) return wholeRecordCandidate(recordId, base, mine, theirs);
  if (base.type !== mine.type || base.type !== theirs.type) return wholeRecordCandidate(recordId, base, mine, theirs);
  const registered = registry.get(base.type);
  registered.adapter.validate(base.value);
  registered.adapter.validate(mine.value);
  registered.adapter.validate(theirs.value);
  const dependencies = [...new Set([...base.dependsOn, ...mine.dependsOn, ...theirs.dependsOn])].sort();
  const valueChanges = registered.adapter.compare(base.value, mine.value, theirs.value).map((change) => ({
    ...change,
    recordId,
    recordType: base.type,
    recordDependencyIds: dependencies,
  }));
  return valueChanges.concat(metadataCandidate(recordId, base.type, base, mine, theirs));
}

/** Produce a deterministic base/mine/theirs semantic comparison. */
export async function compareSemanticSnapshots({ base, mine, theirs }, registry = createDefaultSemanticAdapterRegistry()) {
  const snapshots = {
    base: normalizeSemanticSnapshot(base),
    mine: normalizeSemanticSnapshot(mine),
    theirs: normalizeSemanticSnapshot(theirs),
  };
  const candidates = [];
  const recordIds = [...new Set([
    ...Object.keys(snapshots.base),
    ...Object.keys(snapshots.mine),
    ...Object.keys(snapshots.theirs),
  ])].sort();
  for (const recordId of recordIds) {
    const baseRecord = snapshots.base[recordId] ?? null;
    const mineRecord = snapshots.mine[recordId] ?? null;
    const theirsRecord = snapshots.theirs[recordId] ?? null;
    const dependencies = [...new Set([
      ...(baseRecord?.dependsOn ?? []),
      ...(mineRecord?.dependsOn ?? []),
      ...(theirsRecord?.dependsOn ?? []),
    ])].sort();
    for (const candidate of candidatesForRecord(recordId, baseRecord, mineRecord, theirsRecord, registry)) {
      candidates.push({ ...candidate, recordDependencyIds: candidate.recordDependencyIds ?? dependencies });
    }
  }
  const withIds = [];
  for (const candidate of candidates) {
    const core = {
      recordId: candidate.recordId,
      recordType: candidate.recordType,
      operation: candidate.operation,
      path: candidate.path,
      base: candidate.base,
      mine: candidate.mine,
      theirs: candidate.theirs,
      proposed: candidate.proposed,
      conflict: !!candidate.conflict,
      recordDependencyIds: candidate.recordDependencyIds,
    };
    const changeId = await hashSemanticChange(core);
    withIds.push({ ...core, changeId });
  }
  const changesByRecord = new Map();
  for (const change of withIds) {
    const ids = changesByRecord.get(change.recordId) ?? [];
    ids.push(change.changeId);
    changesByRecord.set(change.recordId, ids);
  }
  const changes = withIds.map((change) => deepFreeze({
    ...change,
    dependencies: [...new Set(change.recordDependencyIds.flatMap((recordId) => changesByRecord.get(recordId) ?? []))]
      .filter((id) => id !== change.changeId)
      .sort(),
  }));
  const links = changes.flatMap((change) => change.dependencies.map((dependency) => link(dependency, change.changeId)));
  toposort(changes.map((change) => change.changeId), links);
  return deepFreeze({
    format: SEMANTIC_COMPARISON_FORMAT,
    schemaVersion: 1,
    baseRoot: await hashIdSecure(snapshots.base, { domain: 'realm-network.branch-state', schemaVersion: 'v1' }),
    mineRoot: await hashIdSecure(snapshots.mine, { domain: 'realm-network.branch-state', schemaVersion: 'v1' }),
    theirsRoot: await hashIdSecure(snapshots.theirs, { domain: 'realm-network.branch-state', schemaVersion: 'v1' }),
    changes,
    conflictIds: changes.filter((change) => change.conflict).map((change) => change.changeId),
  });
}

export function applySemanticChange(snapshot, change, selected, registry) {
  const output = jsonClone(snapshot);
  const slot = assertSlot(selected, 'merge selection');
  if (change.operation === 'record') {
    if (slot.present) output[change.recordId] = normalizeRecord(change.recordId, slot.value);
    else delete output[change.recordId];
    return normalizeSemanticSnapshot(output);
  }
  const record = output[change.recordId];
  if (!record || record.type !== change.recordType) throw new Error(`merge change targets missing record ${change.recordId}`);
  if (change.operation === 'dependencies') {
    if (!slot.present) throw new Error('record dependency metadata cannot be absent');
    record.dependsOn = uniqueTokens(slot.value, 'selected record dependencies');
  } else {
    const registered = registry.get(change.recordType);
    const applied = registered.adapter.apply(record, change, slot);
    output[change.recordId] = normalizeRecord(change.recordId, applied);
  }
  return normalizeSemanticSnapshot(output);
}

export function orderSemanticChanges(changes) {
  const ids = changes.map((change) => change.changeId);
  const links = changes.flatMap((change) => change.dependencies.map((dependency) => link(dependency, change.changeId)));
  const order = toposort(ids, links);
  const byId = new Map(changes.map((change) => [change.changeId, change]));
  return Object.freeze(order.map((id) => byId.get(id)));
}
