// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

import { MORPHFIELD_SCHEMA_VERSION, NEXEL_LIMITS } from './constants.js';
import { failMorphField } from './errors.js';
import {
  canonicalParse,
  canonicalStringify,
  cloneCanonical,
  compareCanonicalStrings,
  isPlainObject,
} from './serialization.js';
import { normalizeNexelDescriptor, validateNexelId } from './validation.js';
import { MORPHFIELD_SCHEMA_IDS } from '../schemas/ids.js';

const SCENE_SCHEMA = 'morphfield-nexel-scene';
const PATCH_SCHEMA = 'morphfield-nexel-patch';
const normalizedPatches = new WeakSet();

function validateSceneId(value) {
  const id = value ?? 'scene';
  if (typeof id !== 'string' || Array.from(id).length === 0 || Array.from(id).length > NEXEL_LIMITS.MAX_SCENE_ID_LENGTH
      || /[\u0000-\u001f\u007f]/u.test(id)) {
    failMorphField('INVALID_SCENE_ID', 'MorphField scene id must be a non-empty string without control characters', {
      value: id,
    });
  }
  return id;
}

function validateUnits(value) {
  const units = value ?? 'meters';
  if (units !== 'meters') {
    failMorphField('UNSUPPORTED_SCENE_UNITS', `MorphField R2 currently supports metric "meters" units, not ${String(units)}`, {
      units,
    });
  }
  return units;
}

function validateRevision(value, path = 'revision') {
  const revision = Number(value);
  if (!Number.isSafeInteger(revision) || revision < 0) {
    failMorphField('INVALID_SCENE_REVISION', `${path} must be a non-negative safe integer`, { path, value });
  }
  return revision;
}

function requireRevisionCapacity(revision, operation) {
  if (revision >= Number.MAX_SAFE_INTEGER) {
    failMorphField(
      'SCENE_REVISION_EXHAUSTED',
      `MorphField scene revision ${revision} cannot advance for ${operation}`,
      { revision, operation, maximum: Number.MAX_SAFE_INTEGER },
    );
  }
}

function normalizePatchUpserts(value) {
  if (value === undefined) return [];
  const entries = value instanceof Map ? [...value.values()] : value;
  if (!Array.isArray(entries)) failMorphField('INVALID_PATCH', 'NexelPatch.upsert must be an array or Map');
  return entries.map((entry, index) => normalizeNexelDescriptor(entry, `patch.upsert[${index}]`));
}

function normalizePatchRemovals(value) {
  if (value === undefined) return [];
  if (!Array.isArray(value) && !(value instanceof Set)) {
    failMorphField('INVALID_PATCH', 'NexelPatch.remove must be an array or Set');
  }
  return [...value].map((id, index) => validateNexelId(id, `patch.remove[${index}]`));
}

function validatePatchEnvelope(input) {
  if (input.$schema !== undefined && input.$schema !== MORPHFIELD_SCHEMA_IDS.patch) {
    failMorphField(
      'PATCH_JSON_SCHEMA_MISMATCH',
      `Expected ${MORPHFIELD_SCHEMA_IDS.patch}, received ${String(input.$schema)}`,
    );
  }
  if (input.schema !== undefined && input.schema !== PATCH_SCHEMA) {
    failMorphField(
      'PATCH_SCHEMA_MISMATCH',
      `Expected ${PATCH_SCHEMA}, received ${String(input.schema)}`,
    );
  }
  if (input.version === undefined) return;
  if (!isPlainObject(input.version)) {
    failMorphField('PATCH_VERSION_MISMATCH', 'MorphField patch version must contain integer major and minor fields');
  }
  const versionKeys = Object.keys(input.version);
  if (versionKeys.length !== 2 || !versionKeys.includes('major') || !versionKeys.includes('minor')) {
    failMorphField('PATCH_VERSION_MISMATCH', 'MorphField patch version must contain only major and minor fields');
  }
  const { major, minor } = input.version;
  if (!Number.isSafeInteger(major) || !Number.isSafeInteger(minor) || major < 0 || minor < 0) {
    failMorphField('PATCH_VERSION_MISMATCH', 'MorphField patch version major and minor must be non-negative safe integers');
  }
  if (major !== MORPHFIELD_SCHEMA_VERSION.major || minor > MORPHFIELD_SCHEMA_VERSION.minor) {
    failMorphField(
      'PATCH_VERSION_MISMATCH',
      `Unsupported MorphField patch version ${major}.${minor}; current version is ${MORPHFIELD_SCHEMA_VERSION.major}.${MORPHFIELD_SCHEMA_VERSION.minor}`,
      { version: { major, minor }, supported: MORPHFIELD_SCHEMA_VERSION },
    );
  }
}

export function normalizeNexelPatch(input) {
  if (input && (typeof input === 'object' || typeof input === 'function') && normalizedPatches.has(input)) {
    return input;
  }
  if (!isPlainObject(input)) failMorphField('INVALID_PATCH', 'NexelPatch must be an object');
  validatePatchEnvelope(input);
  const revision = validateRevision(input.revision, 'patch.revision');
  const completeSnapshot = input.completeSnapshot === true;
  const upsert = normalizePatchUpserts(input.upsert);
  const remove = normalizePatchRemovals(input.remove);
  const touched = new Set();
  for (const descriptor of upsert) {
    if (touched.has(descriptor.id)) failMorphField('DUPLICATE_PATCH_ID', `NexelPatch touches ${descriptor.id} more than once`);
    touched.add(descriptor.id);
  }
  for (const id of remove) {
    if (touched.has(id)) failMorphField('DUPLICATE_PATCH_ID', `NexelPatch touches ${id} more than once`);
    touched.add(id);
  }
  if (completeSnapshot && remove.length > 0) {
    failMorphField('INVALID_COMPLETE_SNAPSHOT', 'A complete snapshot must enumerate its final Nexels and cannot include remove entries');
  }
  if (upsert.length > NEXEL_LIMITS.MAX_NEXELS || touched.size > NEXEL_LIMITS.MAX_NEXELS) {
    failMorphField('NEXEL_COUNT_LIMIT', 'NexelPatch exceeds the scene element limit');
  }
  upsert.sort((a, b) => compareCanonicalStrings(a.id, b.id));
  remove.sort(compareCanonicalStrings);
  const normalized = Object.freeze({
    $schema: MORPHFIELD_SCHEMA_IDS.patch,
    schema: PATCH_SCHEMA,
    version: Object.freeze({ ...MORPHFIELD_SCHEMA_VERSION }),
    revision,
    completeSnapshot,
    upsert: Object.freeze(upsert),
    remove: Object.freeze(remove),
  });
  normalizedPatches.add(normalized);
  return normalized;
}

export class NexelScene {
  #id;
  #units;
  #revision;
  #nexels;

  constructor(options = {}) {
    this.#id = validateSceneId(options.id);
    this.#units = validateUnits(options.units);
    this.#revision = 0;
    this.#nexels = new Map();
    if (options.nexels !== undefined || options.revision !== undefined) {
      const revision = validateRevision(options.revision ?? 0);
      if (options.nexels !== undefined && !Array.isArray(options.nexels)) {
        failMorphField('INVALID_SCENE_NEXELS', 'MorphField scene nexels must be an array');
      }
      const entries = options.nexels ?? [];
      if (entries.length > NEXEL_LIMITS.MAX_NEXELS) failMorphField('NEXEL_COUNT_LIMIT', 'Scene exceeds the Nexel limit');
      for (let index = 0; index < entries.length; index++) {
        const descriptor = normalizeNexelDescriptor(entries[index], `nexels[${index}]`);
        if (this.#nexels.has(descriptor.id)) failMorphField('DUPLICATE_NEXEL_ID', `Duplicate Nexel id: ${descriptor.id}`);
        this.#nexels.set(descriptor.id, descriptor);
      }
      this.#revision = revision;
    }
  }

  get id() { return this.#id; }
  get units() { return this.#units; }
  get revision() { return this.#revision; }
  get size() { return this.#nexels.size; }

  has(id) {
    return this.#nexels.has(String(id));
  }

  get(id) {
    return this.#nexels.get(String(id)) || null;
  }

  ids() {
    return [...this.#nexels.keys()].sort(compareCanonicalStrings);
  }

  values() {
    return this.ids().map(id => this.#nexels.get(id));
  }

  [Symbol.iterator]() {
    return this.values()[Symbol.iterator]();
  }

  upsert(input) {
    requireRevisionCapacity(this.#revision, 'upsert');
    if (this.#nexels.size >= NEXEL_LIMITS.MAX_NEXELS && !this.#nexels.has(input?.id)) {
      failMorphField('NEXEL_COUNT_LIMIT', 'Scene exceeds the Nexel limit');
    }
    const descriptor = normalizeNexelDescriptor(input);
    this.#nexels.set(descriptor.id, descriptor);
    this.#revision += 1;
    return descriptor;
  }

  remove(id) {
    const validId = validateNexelId(id);
    if (!this.#nexels.has(validId)) return false;
    requireRevisionCapacity(this.#revision, 'remove');
    this.#nexels.delete(validId);
    this.#revision += 1;
    return true;
  }

  clear() {
    if (this.#nexels.size === 0) return false;
    requireRevisionCapacity(this.#revision, 'clear');
    this.#nexels.clear();
    this.#revision += 1;
    return true;
  }

  createPatch({ upsert = [], remove = [], completeSnapshot = false } = {}) {
    requireRevisionCapacity(this.#revision, 'createPatch');
    return normalizeNexelPatch({
      revision: this.#revision + 1,
      upsert,
      remove,
      completeSnapshot,
    });
  }

  applyPatch(input) {
    const patch = normalizeNexelPatch(input);
    requireRevisionCapacity(this.#revision, 'applyPatch');
    if (patch.completeSnapshot) {
      if (patch.revision <= this.#revision) {
        failMorphField('STALE_SCENE_REVISION', `Complete snapshot revision ${patch.revision} is not newer than ${this.#revision}`, {
          currentRevision: this.#revision,
          patchRevision: patch.revision,
        });
      }
      this.#nexels = new Map(patch.upsert.map(descriptor => [descriptor.id, descriptor]));
      this.#revision = patch.revision;
      return Object.freeze({ revision: this.#revision, completeSnapshot: true, upserted: patch.upsert.length, removed: 0 });
    }
    const expectedRevision = this.#revision + 1;
    if (patch.revision !== expectedRevision) {
      failMorphField(
        patch.revision < expectedRevision ? 'STALE_SCENE_REVISION' : 'SKIPPED_SCENE_REVISION',
        `Expected patch revision ${expectedRevision}, received ${patch.revision}`,
        { currentRevision: this.#revision, expectedRevision, patchRevision: patch.revision },
      );
    }
    let futureSize = this.#nexels.size;
    for (const id of patch.remove) if (this.#nexels.has(id)) futureSize -= 1;
    for (const descriptor of patch.upsert) if (!this.#nexels.has(descriptor.id)) futureSize += 1;
    if (futureSize > NEXEL_LIMITS.MAX_NEXELS) failMorphField('NEXEL_COUNT_LIMIT', 'Patch would exceed the scene Nexel limit');
    for (const id of patch.remove) this.#nexels.delete(id);
    for (const descriptor of patch.upsert) this.#nexels.set(descriptor.id, descriptor);
    this.#revision = patch.revision;
    return Object.freeze({
      revision: this.#revision,
      completeSnapshot: false,
      upserted: patch.upsert.length,
      removed: patch.remove.length,
    });
  }

  toJSON() {
    return {
      $schema: MORPHFIELD_SCHEMA_IDS.scene,
      schema: SCENE_SCHEMA,
      version: { ...MORPHFIELD_SCHEMA_VERSION },
      id: this.#id,
      units: this.#units,
      revision: this.#revision,
      nexels: this.values().map(descriptor => cloneCanonical(descriptor)),
    };
  }

  serialize() {
    return canonicalStringify(this.toJSON());
  }

  clone() {
    const clone = new NexelScene({ id: this.#id, units: this.#units });
    clone.#revision = this.#revision;
    clone.#nexels = new Map(this.#nexels);
    return clone;
  }

  static fromJSON(input, options = {}) {
    const value = typeof input === 'string' ? canonicalParse(input, options.canonicalization) : input;
    const strictCanonical = options.strictCanonical === true;
    if (!isPlainObject(value)) failMorphField('INVALID_SCENE', 'MorphField scene must be an object');
    if (strictCanonical && value.$schema !== MORPHFIELD_SCHEMA_IDS.scene) {
      failMorphField('SCENE_JSON_SCHEMA_MISMATCH', `Canonical MorphField scenes require ${MORPHFIELD_SCHEMA_IDS.scene}`);
    }
    if (value.$schema !== undefined && value.$schema !== MORPHFIELD_SCHEMA_IDS.scene) {
      failMorphField('SCENE_JSON_SCHEMA_MISMATCH', `Expected ${MORPHFIELD_SCHEMA_IDS.scene}, received ${String(value.$schema)}`);
    }
    if (strictCanonical && value.schema !== SCENE_SCHEMA) {
      failMorphField('SCENE_SCHEMA_MISMATCH', `Canonical MorphField scenes require ${SCENE_SCHEMA}`);
    }
    if (value.schema !== undefined && value.schema !== SCENE_SCHEMA) {
      failMorphField('SCENE_SCHEMA_MISMATCH', `Expected ${SCENE_SCHEMA}, received ${String(value.schema)}`);
    }
    const major = Number(value.version?.major ?? MORPHFIELD_SCHEMA_VERSION.major);
    if (major !== MORPHFIELD_SCHEMA_VERSION.major) {
      failMorphField('SCENE_VERSION_MISMATCH', `Unsupported MorphField scene major version ${major}`);
    }
    if (value.version !== undefined) {
      const minor = Number(value.version?.minor);
      if (!Number.isSafeInteger(minor) || minor < 0) {
        failMorphField('SCENE_VERSION_MISMATCH', 'MorphField scene minor version must be a non-negative integer');
      }
    }
    if (strictCanonical && (!isPlainObject(value.version)
        || Number(value.version.major) !== MORPHFIELD_SCHEMA_VERSION.major
        || Number(value.version.minor) !== MORPHFIELD_SCHEMA_VERSION.minor)) {
      failMorphField(
        'SCENE_VERSION_MISMATCH',
        `Canonical MorphField scenes require version ${MORPHFIELD_SCHEMA_VERSION.major}.${MORPHFIELD_SCHEMA_VERSION.minor}`,
      );
    }
    if (!Array.isArray(value.nexels)) {
      failMorphField('INVALID_SCENE_NEXELS', 'MorphField scene nexels must be an array');
    }
    const scene = new NexelScene({
      id: value.id,
      units: value.units,
      revision: value.revision,
      nexels: value.nexels,
    });
    if (strictCanonical && canonicalStringify(value) !== scene.serialize()) {
      failMorphField(
        'SCENE_CANONICAL_MISMATCH',
        'MorphField MANF must exactly match the canonical semantic scene envelope',
      );
    }
    return scene;
  }
}

export function createNexelScene(options) {
  return new NexelScene(options);
}

export function isNexelScene(value) {
  return value instanceof NexelScene;
}

export {
  PATCH_SCHEMA as NEXEL_PATCH_SCHEMA,
  SCENE_SCHEMA as NEXEL_SCENE_SCHEMA,
};
